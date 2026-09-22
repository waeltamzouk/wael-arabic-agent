import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { depthMetric, record } from "@/lib/stats";
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

// Said back to the visitor if Claude produces no text at all. Keyed by
// language: the form case fires at the exact moment someone is being asked for
// a phone number, and answering an English visitor in Arabic there is the
// worst possible place to slip.
const FALLBACK_REPLY = {
  form: {
    ar: "عبّي بياناتك تحت وأرسلها، ووائل بيتواصل معك قريباً.",
    en: "Fill in your details below and send them — Wael will be in touch shortly.",
  },
  plain: {
    ar: "تعذر إنشاء الرد. حاول مرة أخرى.",
    en: "The reply could not be generated. Please try again.",
  },
} as const;

// NOT a "save the lead" tool any more. Claude no longer handles the name or
// the phone number at all — it decides WHEN to ask, and the visitor types the
// answer into a real form that posts straight to /api/lead.
//
// Why: a number copied out of a chat sentence arrives however it was typed
// ("0551234567", two numbers at once, "call me after 5pm"), and then nothing
// downstream can be sure which country it is from. A form with a country
// dropdown removes the guess entirely. See lib/whatsapp.ts for what the
// guessing used to cost.
//
// The fields here are the notes Claude DID gather from the conversation. They
// ride along with the form and come back with it, so the lead email still has
// the budget and the timeline in it.
const CONTACT_TOOL: Anthropic.Tool = {
  name: "request_contact",
  description:
    "Show the visitor a short form asking for their name and phone number. Call this once, at the moment the visitor should be asked for their contact details. Do NOT ask for a name or a phone number in your own words — this form is the only way to collect them. Fill every other field you can from the conversation; leave a field out if the visitor never answered it.",
  input_schema: {
    type: "object",
    properties: {
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
    required: ["type"],
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

function refuse(req: NextRequest, failure: GuardFailure, metric: string) {
  console.warn("Blocked /api/chat request:", failure.error);
  record(metric);
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

// GOTCHA that cost a live bug: the heading used to read "THIS OVERRIDES EVERY
// RULE ABOVE". It was only ever meant to override the LANGUAGE rules, but the
// model read it literally and dropped the no-greeting rule with it — an
// English visitor got "Hi! How can I help you today?" on top of the site's own
// welcome bubble. Scope the override, and restate the greeting ban here, where
// recency actually makes it stick.
//
// KEEP THE TWO DIRECTIVES SYMMETRIC. The greeting ban held 9/9 in English and
// slipped in Arabic, and the difference was in the wording, not the language:
// English said "or any other greeting word", Arabic listed four strings and
// stopped. The model slipped out through "أهلاً وسهلاً", which is not one of
// the four. A closed list reads as the whole rule. Say the list is examples.
const ENGLISH_DIRECTIVE = `

## THIS REPLY — LANGUAGE AND OPENING
This section overrides the LANGUAGE rules above and nothing else. Every other
rule in the prompt still applies in full.

The visitor's latest message is in ENGLISH. Write your entire reply in
English, from the first word to the last. Do not write a single Arabic
sentence. Give the English preview link and, only if they asked to buy, the
English Polar link. Never give the waelwebdesign.com template page to an
English speaker — that page is Arabic only.

NEVER GREET, and this holds in English exactly as it does in Arabic. The
website already greeted this visitor with a welcome message you cannot see, so
a greeting from you is the second one they read. Do not open with "Hi",
"Hello", "Hey", "Welcome" or any other greeting word.

If their message is ONLY a greeting with no question, do not greet back and do
not ask "how can I help you" — that wastes the whole reply and they already
know they can ask. Open with something concrete instead: the websites Wael
builds and what they cost, or the six ready-made templates.`;

const ARABIC_DIRECTIVE = `

## قواعد هذا الرد بالذات
آخر رسالة من الزائر بالعربية. رد بالعربية كاملة.
وإذا كان مهتماً بقالب، أعطه صفحة القالب على موقع وائل، وهي الرابط
الافتراضي الوحيد.
ممنوع في هذا الرد أن تعطي رابط Polar أو تذكره أو تلمّح له، إلا إذا كانت
آخر رسالة من الزائر تطلب الشراء أو الحصول على القالب صراحةً. إذا لم يطلب
ذلك بنفسه، فلا وجود لرابط Polar في ردك إطلاقاً.
وممنوع تبدأ ردك بتحية، وهذا ينطبق بالعربية تماماً مثل الإنجليزية. الموقع
رحّب بالزائر قبلك برسالة أنت ما تشوفها، فأي تحية منك هي التحية الثانية
اللي يقراها.
القاعدة هي منع التحية نفسها، مو منع كلمات بعينها. وهذي أمثلة وليست
حصراً: "مرحباً"، "أهلاً"، "أهلاً بك"، "أهلاً وسهلاً"، "هلا"، "يا هلا"،
"حياك الله"، "السلام عليكم"، "وعليكم السلام"، "صباح الخير"، "مساء
الخير"، "تحية طيبة". أي صيغة تحية أخرى غير مذكورة هنا ممنوعة كذلك.
وحتى لو بدأ الزائر رسالته بتحية، لا ترد تحيته ولا تقابلها بمثلها. تجاهلها
تماماً وابدأ بالمحتوى من أول كلمة.
وإذا كانت رسالته مجرد تحية بدون سؤال، لا ترد التحية ولا تسأل "كيف أقدر
أساعدك" ولا "كيف أساعدك" ولا "وش تحتاج" ولا أي صيغة ثانية من نفس
السؤال — هذا يضيّع الرد كله وهو أصلاً يعرف إنه يقدر يسأل. بدل ذلك ابدأ
بشيء ملموس: المواقع اللي يصممها وائل وأسعارها، أو القوالب الجاهزة الستة.`;

function languageOf(messages: ChatMessage[]): "ar" | "en" {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return lastUser ? detectLanguage(lastUser.content) : "ar";
}

function systemFor(language: "ar" | "en") {
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
    }, "blocked_origin");
  }

  const limited = rateLimit(clientIp(req));
  if (limited) return refuse(req, limited, "blocked_rate");

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
  if (oversized) return refuse(req, oversized, "blocked_size");

  try {
    // Computed ONCE and used for BOTH calls in the tool loop. The second call's
    // last message is a tool_result, so recomputing it there would read the
    // wrong message and could flip the language mid-answer.
    const language = languageOf(messages);
    const system = systemFor(language);

    // Funnel milestones. `depthMetric` only returns a value at exact lengths a
    // conversation passes through once, so this counts each conversation once
    // per milestone without storing anything about who it was. Language is
    // recorded only at the first message, so one conversation counts once.
    const milestone = depthMetric(messages.length);
    if (milestone) {
      record(
        milestone,
        ...(milestone === "started" ? [`lang_${language}`] : [])
      );
    }

    const first = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [CONTACT_TOOL],
      messages,
    });

    let final = first;

    // Claude decided it is time to ask for contact details. Nothing is emailed
    // here — the route tells the widget to show the form, and the form posts
    // to /api/lead when the visitor sends it.
    const toolUse = first.content.find((block) => block.type === "tool_use");

    if (toolUse) {
      record("form_shown");

      final = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: [CONTACT_TOOL],
        // `tools` must stay — the API rejects a conversation containing
        // tool_use blocks when it is missing. But this call's only job is to
        // write the sentence the visitor reads, so forbid a SECOND tool call:
        // the loop is one iteration deep, so a second call would be silently
        // dropped, and a reply that is nothing but a tool_use has no text at
        // all and falls through to the canned line.
        tool_choice: { type: "none" },
        messages: [
          ...messages,
          { role: "assistant", content: first.content },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolUse.id,
                // Claude's only remaining job is the sentence above the
                // form, so tell it exactly what the visitor can now see.
                content:
                  "The contact form is now shown to the visitor, below your reply. Write one short sentence asking them to fill it in. Do not ask for their name or phone number in words, and do not thank them for details they have not sent yet.",
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
    return json(req, {
      reply: reply || FALLBACK_REPLY[toolUse ? "form" : "plain"][language],
      // Present ONLY when the form should appear. `notes` is what Claude
      // gathered from the conversation; it rides out to the browser and comes
      // back with the form, and /api/lead re-checks every field of it, because
      // by then it has been through a stranger's browser.
      ...(toolUse
        ? { contactForm: { language, notes: toolUse.input } }
        : {}),
    });
  } catch (error) {
    console.error("Anthropic API error:", error);

    if (error instanceof Anthropic.APIError) {
      return json(req, { error: error.message }, error.status ?? 500);
    }

    return json(req, { error: "Something went wrong talking to Claude." }, 500);
  }
}
