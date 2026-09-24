// One WhatsApp turn: the stored history plus the new message in, one reply out.
// SAME BRAIN as the website — the same prompt, the same cached prefix, the same
// language directive, the same stripMarkdown, the same model — imported from
// lib/agent.ts, not copied. What differs is only what the channel forces:
//
// WHAT request_contact BECOMES ON WHATSAPP, and it is the decision this file is
// built around. On the website it shows a form with a country dropdown, and
// the whole reason that form exists is that a number typed into a chat arrives
// with no country ("0551234567" is a real mobile in Saudi AND the UAE). On
// WhatsApp that problem does not exist: Meta hands over the sender's number,
// with its country code, on every message. So the only thing left to collect
// is the NAME, and the one step splits in two:
//
//   request_contact  SAME tool, same name, same notes, same timing rules in the
//                    prompt. On WhatsApp it shows nothing — the server keeps the
//                    notes and tells Claude to ask for the name in words. It is
//                    counted as `whatsapp_form_shown`, the website's twin.
//   send_lead        NEW, WhatsApp only. Called once the name arrives. The
//                    server builds the lead from the name + the stored notes +
//                    the WhatsApp number and emails it with the same sendLead as
//                    /api/lead. Counted as `whatsapp_form_submitted`.
//
// Keeping request_contact unchanged means every "when to ask, when never to
// ask" rule in the prompt applies on WhatsApp without a word of it being
// rewritten. The WhatsApp directive below only overrides the ONE rule that is
// wrong here — "never ask for a name in words" — because on WhatsApp asking in
// words IS the form. The ban on asking for a phone number stays, harder.
//
// The lead is sent by the SERVER, from state, never twice: `leadSent` lives on
// the conversation record, so neither a trimmed history nor Claude calling the
// tool again can produce a second email.

import Anthropic from "@anthropic-ai/sdk";
import {
  CONTACT_TOOL,
  FALLBACK_REPLY,
  MAX_TOKENS,
  MODEL,
  languageOf,
  stripMarkdown,
  systemFor,
  type ChatMessage,
} from "@/lib/agent";
import { sendLead, type Lead } from "@/lib/send-lead";
import { DEFAULT_SITE } from "@/lib/site";
import { record, whatsappMetric } from "@/lib/stats";
import { whatsappLink } from "@/lib/whatsapp";
import type { Conversation, Notes } from "@/lib/whatsapp-memory";

const anthropic = new Anthropic();

// WhatsApp answers for the Arabic site's agent: Wael's services and his six
// templates. A client's number would name the client's site here.
const SITE = DEFAULT_SITE;

// The note fields request_contact collects, and the only keys ever stored or
// emailed — the same allowlist /api/lead applies to the form's notes.
const NOTE_FIELDS = ["business", "project", "budget", "timeline", "needs", "quality"] as const;
const MAX_FIELD = 300;
const MAX_NAME = 80;

// Same name and schema as the website's tool, so the prompt's rules about it
// hold unchanged. Only the description changes: there is no form to "show".
const WHATSAPP_CONTACT_TOOL: Anthropic.Tool = {
  ...CONTACT_TOOL,
  description:
    "Call this once, at the moment the prompt says to show the contact form. On WhatsApp there is no form: this records what you learned about the project, and then you ask for the person's NAME in your own words. Their phone number is already known — never ask for it. Fill every field you can from the conversation; leave a field out if they never answered it.",
};

const SEND_LEAD_TOOL: Anthropic.Tool = {
  name: "send_lead",
  description:
    "Email this lead to Wael. WhatsApp only. Call it once, after you asked for their name and they answered. If they would not give a name, call it without one — their WhatsApp number is already attached and is enough for Wael to reach them. Never call it twice.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The name they gave you, as they wrote it." },
      ...(CONTACT_TOOL.input_schema.properties as Record<string, unknown>),
    },
  },
};

const TOOLS = [WHATSAPP_CONTACT_TOOL, SEND_LEAD_TOOL];

// The website shows this in the widget before the visitor types, and never
// sends it to Claude — which is why both directives ban greeting. WhatsApp has
// no widget, so the FIRST reply of a conversation opens with it instead. That
// keeps the directives true ("you were already greeted") and it tells the
// person they are talking to an assistant, which on WhatsApp they cannot see
// from the screen. Same Arabic sentence as the widget, first half.
export const WELCOME = {
  ar: "أهلاً بك. أنا مساعد وائل لتصميم المواقع.",
  en: "Hi, I'm Wael's website design assistant.",
} as const;

// Written in ENGLISH, like the website's English directive: in a mostly-Arabic
// prompt an English block stands out, and this one has to beat a rule the
// prompt states firmly ("never ask for the name").
function whatsappDirective(conversation: Conversation, profileName: string): string {
  const lines = [
    "",
    "",
    "## THIS CONVERSATION IS ON WHATSAPP",
    "This section changes HOW contact details are collected, and nothing else. Every other rule above still applies in full: prices, templates, links, the five qualifying questions one at a time, when to ask for contact details and when never to, no markdown, no emoji, never greet.",
    "",
    "There is no form on WhatsApp. Their phone number is already known — it is the number they are writing from — so NEVER ask for a phone number or ask them to confirm one.",
    "",
    "The only detail to ask for is their NAME. The contact step works in two moves:",
    "1. At the exact moment the prompt says to show the form, call request_contact exactly as described there, same timing and same notes. It shows nothing on WhatsApp. Then ask for their name in one short sentence, in their language. This overrides the rule against asking for a name in your own words: on WhatsApp, asking for the name IS the form.",
    "2. When they answer with their name, call send_lead with it. That emails Wael. If they will not give a name, call send_lead without one.",
    "",
    "Links are tappable on WhatsApp. Give them as plain URLs, exactly as written above.",
  ];

  const shown = profileName.replace(/[\r\n"]/g, " ").trim().slice(0, 40);
  if (shown && !conversation.leadSent) {
    lines.push(
      "",
      `Their WhatsApp profile name is "${shown}". It may be a nickname or a business name, so do not assume it is their name — you may offer it and let them confirm or correct it.`
    );
  }

  if (conversation.leadSent) {
    lines.push(
      "",
      "STATE: their details have ALREADY been sent to Wael in this conversation. Do not ask for their name again and do not call request_contact or send_lead. Answer their questions normally. If it comes up, Wael will contact them on this WhatsApp number."
    );
  } else if (conversation.asked) {
    lines.push(
      "",
      "STATE: you have ALREADY asked for their name (request_contact was called). Do not call request_contact again. If their latest message gives a name, or clearly declines to, call send_lead now."
    );
  }

  return lines.join("\n");
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function pickNotes(input: unknown): Notes {
  const source = (input ?? {}) as Record<string, unknown>;
  const notes: Notes = {};
  for (const field of [...NOTE_FIELDS, "type"] as const) {
    const value = text(source[field], MAX_FIELD);
    if (value) notes[field] = value;
  }
  return notes;
}

// What each tool call does on the server, and the sentence Claude is told
// afterwards. `conversation` is updated in place; the caller saves it only if
// the reply actually reaches the person.
async function runTool(
  toolUse: Anthropic.ToolUseBlock,
  conversation: Conversation,
  from: string,
  profileName: string
): Promise<string> {
  if (conversation.leadSent) {
    return "Their details were already sent to Wael earlier in this conversation. Nothing was sent again. Do not ask for their name. Answer their latest message normally.";
  }

  if (toolUse.name === WHATSAPP_CONTACT_TOOL.name) {
    if (!conversation.asked) record(whatsappMetric("form_shown"));
    conversation.asked = true;
    conversation.notes = { ...conversation.notes, ...pickNotes(toolUse.input) };
    return "Noted. There is no form on WhatsApp and their phone number is already known. Now ask for their name in one short sentence, in their language. Do not ask for their phone number, and do not thank them for details they have not sent yet.";
  }

  // send_lead
  const input = (toolUse.input ?? {}) as Record<string, unknown>;
  const notes = { ...conversation.notes, ...pickNotes(input) };
  const phone = `+${from}`;

  // The number came from Meta, so it is always well formed — but this is the
  // app's ONE definition of a usable number, and it is cheap to hold to it.
  if (!whatsappLink(phone).ok) {
    console.error(`[whatsapp] unusable sender number …${from.slice(-4)}, lead not sent.`);
    return "Their details could not be sent. Tell them Wael will read this conversation and reply here.";
  }

  const lead: Lead = {
    // Their answer first; the profile name only if they declined, marked so
    // Wael knows it is not a name they gave.
    name:
      text(input.name, MAX_NAME) ||
      (profileName ? `${profileName.slice(0, MAX_NAME)} (WhatsApp profile name)` : "(not given)"),
    phone,
    channel: "WhatsApp",
    type: notes.type === "template" ? "template" : "project",
  };
  for (const field of NOTE_FIELDS) {
    if (notes[field]) lead[field] = notes[field];
  }

  const sent = await sendLead(lead);

  if (!sent) {
    // sendLead logged the Resend reason. The lead itself is logged too, so it
    // can be emailed by hand — the number is Wael's to reach, and the Vercel
    // log is the only other place it exists. Left UNSENT on the record, so a
    // later send_lead in this conversation tries again.
    console.error("[whatsapp] lead NOT emailed, add it by hand:", JSON.stringify(lead));
    record(whatsappMetric("lead_failed"));
    return "Their details could not be emailed just now. Tell them in one short sentence that their request is noted and Wael will get back to them here on WhatsApp. Do not ask for anything again.";
  }

  // A lead sent without request_contact first (they volunteered their name)
  // still counts as shown, so the funnel can never show more submitted than
  // shown — a funnel that runs backwards is the bug CLAUDE.md warns about.
  record(
    ...(conversation.asked ? [] : [whatsappMetric("form_shown")]),
    whatsappMetric("form_submitted"),
    whatsappMetric(lead.type === "template" ? "lead_template" : "lead_project")
  );
  conversation.asked = true;
  conversation.leadSent = true;
  conversation.notes = {};

  return "Sent to Wael. Write one short sentence telling them Wael will contact them on this WhatsApp number soon. Do not ask for anything else.";
}

export type Turn = { reply: string; language: "ar" | "en" };

/**
 * Claude's reply to `messages` (the trimmed history, ending with the new
 * visitor message). The same one-deep tool loop as the website route: at most
 * one tool call, then a second call with tool_choice none that only writes the
 * sentence the person reads.
 *
 * Throws on an Anthropic error; the caller answers with the fallback line.
 */
export async function whatsappTurn(
  messages: ChatMessage[],
  conversation: Conversation,
  from: string,
  profileName: string
): Promise<Turn> {
  const language = languageOf(messages, SITE);
  const system = systemFor(SITE, language, whatsappDirective(conversation, profileName));

  const first = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    tools: TOOLS,
    messages,
  });

  let final = first;
  const toolUse = first.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (toolUse) {
    const result = await runTool(toolUse, conversation, from, profileName);

    final = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: TOOLS,
      tool_choice: { type: "none" },
      messages: [
        ...messages,
        { role: "assistant", content: first.content },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: toolUse.id, content: result }],
        },
      ],
    });
  }

  const reply = stripMarkdown(
    final.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
  ).trim();

  return { reply: reply || FALLBACK_REPLY.plain[language], language };
}
