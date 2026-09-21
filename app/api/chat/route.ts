import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { sendLead, type Lead } from "@/lib/send-lead";

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

export async function POST(req: NextRequest) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = (body as { messages?: unknown })?.messages;

  if (!isValidMessages(messages)) {
    return NextResponse.json(
      {
        error:
          "Expected { messages: [{ role: 'user' | 'assistant', content: string }] }.",
      },
      { status: 400 }
    );
  }

  try {
    const first = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
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
        system: SYSTEM_PROMPT,
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
    return NextResponse.json({ reply: reply || LEAD_SENT_REPLY });
  } catch (error) {
    console.error("Anthropic API error:", error);

    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status ?? 500 }
      );
    }

    return NextResponse.json(
      { error: "Something went wrong talking to Claude." },
      { status: 500 }
    );
  }
}
