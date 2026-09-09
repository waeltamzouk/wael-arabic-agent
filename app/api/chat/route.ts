import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";

const anthropic = new Anthropic();

const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 1024;

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
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return NextResponse.json({ reply });
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
