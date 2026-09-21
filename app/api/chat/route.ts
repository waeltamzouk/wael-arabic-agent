import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { sendLead, type Lead } from "@/lib/send-lead";
import {
  checkSize,
  clientIp,
  corsHeaders,
  isAllowedOrigin,
  rateLimit,
  type GuardFailure,
} from "@/lib/guard";

const anthropic = new Anthropic();

const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 1024;

// Said back to the visitor if Claude calls the tool again instead of writing text.
const LEAD_SENT_REPLY = "تم تسجيل بياناتك. وائل بيتواصل معك قريباً.";

const LEAD_TOOL: Anthropic.Tool = {
  name: "save_lead",
  description:
    "Send the visitor's details to Wael by email. Call this once, only after the visitor has given BOTH their name and phone number. Fill every field you can from the conversation; leave a field out if the visitor never answered it.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Visitor's name." },
      phone: { type: "string", description: "Visitor's phone number." },
      type: {
        type: "string",
        enum: ["project", "template"],
        description:
          "'project' when the visitor wants a new site built. 'template' when the visitor wants one of the ready-made templates customized.",
      },
      business: { type: "string", description: "What the business does." },
      project: {
        type: "string",
        description:
          "For a project lead: landing page, business website, advanced website. For a template lead: the template being customized, e.g. تخصيص قالب نَبض.",
      },
      budget: { type: "string", description: "Rough budget the visitor gave." },
      timeline: { type: "string", description: "When they want to launch." },
      needs: {
        type: "string",
        description:
          "Existing content and branding, or starting from scratch.",
      },
      quality: {
        type: "string",
        enum: ["hot", "warm", "cold"],
        description: "How ready to buy the visitor seems.",
      },
    },
    required: ["name", "phone", "type"],
  },
};

// The chat bubbles render plain text (whitespace-pre-wrap), so any markdown
// Claude emits is shown to the visitor literally as ** and #. The prompt
// forbids it, but that rule slips on list-shaped English answers, so strip it
// here too. Cheap, deterministic, and none of these markers are ever wanted.
function stripMarkdown(text: string) {
  return text
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/__([\s\S]+?)__/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "");
}

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function isValidMessages(value: unknown): value is ChatMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
  );
}

// Every response carries the CORS headers, including the failures. A browser
// that cannot read the reply just shows the generic error instead of the real
// reason, which makes debugging the embed much harder than it needs to be.
function json(req: NextRequest, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(req) });
}

function refuse(req: NextRequest, failure: GuardFailure) {
  console.warn("Blocked /api/chat request:", failure.error);
  return json(req, { error: failure.error, notice: failure.notice }, failure.status);
}

// The browser's CORS preflight. Only fires when the widget is loaded straight
// onto another origin; the iframe at /embed is same-origin and never sends one.
export async function OPTIONS(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// The prompt is ~250 lines of Arabic, so a single Arabic rule saying "reply in
// the visitor's language" gets drowned out — Claude answers English questions
// in Arabic. Moving the rule to the very end did not fix it either. Same story
// as the markdown slip: a prompt rule alone is not enough, so pin it down in
// code. Detecting the script is deterministic, and the directive is written in
// ENGLISH on purpose — in a mostly-Arabic prompt it stands out.
function detectLanguage(text: string): "ar" | "en" {
  const arabic = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return latin > arabic ? "en" : "ar";
}

const ENGLISH_DIRECTIVE = `

## LANGUAGE OF THIS REPLY — THIS OVERRIDES EVERY RULE ABOVE
The visitor's latest message is in ENGLISH. Write your entire reply in
English, from the first word to the last. Do not write a single Arabic
sentence. Give the English preview link and, only if they asked to buy, the
English Polar link. Never give the waelwebdesign.com template page to an
English speaker — that page is Arabic only.`;

const ARABIC_DIRECTIVE = `

## قواعد هذا الرد بالذات
آخر رسالة من الزائر بالعربية. رد بالعربية كاملة.
وإذا كان مهتماً بقالب، أعطه صفحة القالب على موقع وائل، وهي الرابط
الافتراضي الوحيد.
ممنوع في هذا الرد أن تعطي رابط Polar أو تذكره أو تلمّح له، إلا إذا كانت
آخر رسالة من الزائر تطلب الشراء أو الحصول على القالب صراحةً. إذا لم يطلب
ذلك بنفسه، فلا وجود لرابط Polar في ردك إطلاقاً.`;

function systemFor(messages: ChatMessage[]) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const language = lastUser ? detectLanguage(lastUser.content) : "ar";
  return (
    SYSTEM_PROMPT +
    (language === "en" ? ENGLISH_DIRECTIVE : ARABIC_DIRECTIVE)
  );
}

export async function POST(req: NextRequest) {
  // Cheapest check first, and the only one that runs before the body is read.
  if (!isAllowedOrigin(req)) {
    return refuse(req, {
      status: 403,
      error: `Origin not allowed: ${req.headers.get("origin") ?? "(none)"}.`,
      notice: "غير مصرح.",
    });
  }

  const limited = rateLimit(clientIp(req));
  if (limited) return refuse(req, limited);

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body." }, 400);
  }

  const messages = (body as { messages?: unknown })?.messages;

  if (!isValidMessages(messages)) {
    return json(
      req,
      {
        error:
          "Expected { messages: [{ role: 'user' | 'assistant', content: string }] }.",
      },
      400
    );
  }

  // Size caps last: they need a parsed, valid body, and they are what stop one
  // oversized conversation costing a fortune.
  const oversized = checkSize(messages);
  if (oversized) return refuse(req, oversized);

  try {
    const system = systemFor(messages);

    const first = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [LEAD_TOOL],
      messages,
    });

    let final = first;

    // Claude asked for the lead to be emailed. Send it, tell Claude it worked,
    // then let Claude write the reply the visitor actually sees.
    const toolUse = first.content.find((block) => block.type === "tool_use");

    if (toolUse) {
      const sent = await sendLead(toolUse.input as Lead);

      final = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: [LEAD_TOOL],
        messages: [
          ...messages,
          { role: "assistant", content: first.content },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: sent
                  ? "Lead sent to Wael."
                  : "Lead could not be sent.",
              },
            ],
          },
        ],
      });
    }

    const reply = stripMarkdown(
      final.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
    );

    // The widget throws on an empty reply, so never return one.
    return json(req, { reply: reply || LEAD_SENT_REPLY });
  } catch (error) {
    console.error("Anthropic API error:", error);

    if (error instanceof Anthropic.APIError) {
      return json(req, { error: error.message }, error.status ?? 500);
    }

    return json(req, { error: "Something went wrong talking to Claude." }, 500);
  }
}
