// Meta calls this for every WhatsApp message sent to Wael's business number.
// Same agent as the website bubble; the brain is lib/agent.ts, the turn is
// lib/whatsapp-agent.ts, the memory is lib/whatsapp-memory.ts. This file is
// only the door: check it is Meta, take the messages, answer later.
//
// WHY NOT /api/chat: that route's first check is the browser Origin allowlist
// in lib/guard.ts, and Meta's servers send no Origin header — every message
// would be a 403. The lock here is Meta's signature instead, the same shape as
// /api/polar: a server calling a server, proven by a shared secret.
//
// What IS reused from the guard: the rate limiter (keyed by the sender's
// number, NOT the IP — every webhook comes from Meta's IPs, so an IP limit
// would throttle all of Wael's customers as one), and the size caps (as a trim,
// see lib/whatsapp-memory.ts).
//
// Status codes:
//   GET  200 + hub.challenge  the one-time handshake when the webhook is saved
//   GET  403                  wrong verify token
//   POST 403                  bad signature. Refused, loudly, every time.
//   POST 500                  WHATSAPP_APP_SECRET missing — nothing can be
//                             verified, so nothing is processed.
//   POST 200                  EVERYTHING ELSE, immediately, before Claude is
//                             called. Meta wants an answer within seconds and
//                             re-delivers anything it thinks failed; a Claude
//                             turn takes 5-15. The work runs in `after()`.

import { after, NextRequest, NextResponse } from "next/server";
import { FALLBACK_REPLY, languageOf } from "@/lib/agent";
import { MAX_MESSAGE_CHARS, rateLimit } from "@/lib/guard";
import { DEFAULT_SITE } from "@/lib/site";
import { depthMetric, record, whatsappMetric } from "@/lib/stats";
import { WELCOME, whatsappTurn } from "@/lib/whatsapp-agent";
import {
  readInbound,
  sendText,
  showTyping,
  verifyMetaSignature,
  type Inbound,
} from "@/lib/whatsapp-cloud";
import {
  enqueue,
  firstDelivery,
  loadConversation,
  lock,
  mayNotify,
  queuedCount,
  saveConversation,
  takeQueued,
  trimHistory,
  unlock,
  withUserMessage,
  type Queued,
} from "@/lib/whatsapp-memory";

// node:crypto and the raw body both need the Node runtime.
export const runtime = "nodejs";

// `after()` runs inside this budget. A turn is two Claude calls at most.
export const maxDuration = 60;

// A real delivery is a few kB. Not the security boundary — the signature is.
const MAX_BODY_BYTES = 256 * 1024;

// Stop STARTING new turns after this, so the last one finishes inside
// maxDuration. Anything still waiting is answered with their next message.
const TURN_BUDGET_MS = 35_000;
const MAX_PASSES = 3;

// People type one thought across several lines: "مرحبا" / "عندي سؤال" /
// "كم سعر صفحة الهبوط؟". Without a pause the first line is answered alone the
// instant it lands, and the rest get a second reply — measured, two replies to
// that exact burst. Two seconds is enough to catch the burst and nothing next
// to a 5-15 second Claude turn.
const BURST_WAIT_MS = 2_000;

// A day old means the 24-hour window is closed and a reply would be refused.
const MAX_AGE_SECONDS = 24 * 60 * 60;

// Reactions and system notices ("number changed") are not messages to answer.
const IGNORED = new Set(["reaction", "system", "unsupported", "errors"]);

// Voice notes are everywhere in the Gulf, so this WILL be seen.
const NOT_TEXT = {
  ar: "حالياً أقدر أقرأ الرسائل المكتوبة فقط. اكتب لي سؤالك وأجاوبك.",
  en: "I can only read text messages for now. Type your question and I'll answer it.",
} as const;

// ---------------------------------------------------------------------------
// The handshake
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  const params = req.nextUrl.searchParams;

  if (!expected) {
    console.error(
      "[whatsapp] WHATSAPP_VERIFY_TOKEN is not set, so Meta's webhook check cannot pass. Set it in Vercel to the same word typed into Meta's webhook page, then redeploy."
    );
    return new NextResponse("Not configured.", { status: 500 });
  }

  if (params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === expected) {
    return new NextResponse(params.get("hub.challenge") ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  console.warn("[whatsapp] webhook handshake refused: wrong verify token.");
  return new NextResponse("Forbidden.", { status: 403 });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();

  if (!secret) {
    console.error(
      "[whatsapp] WHATSAPP_APP_SECRET is not set. Nothing can be verified, so nothing was answered. Copy it from the Meta app: App settings → Basic → App Secret."
    );
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Body too large." }, { status: 400 });
  }

  // MUST be the raw text — see verifyMetaSignature. Read once, verify, parse.
  const raw = await req.text();

  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Body too large." }, { status: 400 });
  }

  const verdict = verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secret);

  if (!verdict.ok) {
    console.warn("[whatsapp] refused a webhook call:", verdict.reason);
    record(whatsappMetric("refused"));
    return NextResponse.json({ error: "Invalid signature." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const inbound = readInbound(payload, process.env.WHATSAPP_PHONE_NUMBER_ID?.trim());

  // Most deliveries are read receipts for our own replies and carry no
  // message at all. They end here.
  if (inbound.length > 0) {
    after(async () => {
      try {
        await handle(inbound);
      } catch (error) {
        // Usually Upstash. Logged, never re-thrown: the 200 is already sent.
        console.error("[whatsapp] could not handle a delivery:", error);
      }
    });
  }

  return NextResponse.json({ ok: true });
}

async function handle(inbound: Inbound[]) {
  const senders = new Map<string, string>();
  const now = Date.now() / 1000;

  for (const message of inbound) {
    if (!(await firstDelivery(message.id))) {
      console.log(`[whatsapp] duplicate delivery of ${message.id}, ignored.`);
      continue;
    }
    if (IGNORED.has(message.type)) continue;
    if (message.timestamp && now - message.timestamp > MAX_AGE_SECONDS) {
      console.warn(`[whatsapp] ${message.id} is over a day old, the window is closed. Not answered.`);
      continue;
    }

    if (message.type !== "text" || !message.text.trim()) {
      record(whatsappMetric("not_text"));
      if (await mayNotify(message.from, "not_text")) {
        const { messages } = await loadConversation(message.from);
        const language = messages.length ? languageOf(messages, DEFAULT_SITE) : "ar";
        await sendText(message.from, NOT_TEXT[language]);
      }
      continue;
    }

    let text = message.text.trim();
    if (text.length > MAX_MESSAGE_CHARS) {
      text = text.slice(0, MAX_MESSAGE_CHARS);
      record(whatsappMetric("blocked_size"));
    }

    await enqueue(message.from, { id: message.id, text });
    senders.set(message.from, message.profileName);
  }

  for (const [from, profileName] of senders) {
    await drain(from, profileName);
  }
}

/**
 * Answers everything waiting for one number, one turn at a time. Only the
 * holder of the number's lock gets past the first line; anyone else returns at
 * once, knowing their message is in the inbox and the holder will take it.
 *
 * The re-check after unlocking closes the one gap: a message that arrived
 * between the last empty inbox and the unlock found the lock taken, so it is
 * still waiting — and nobody else is coming for it.
 */
async function drain(from: string, profileName: string) {
  const started = Date.now();

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (!(await lock(from))) return;

    try {
      while (Date.now() - started < TURN_BUDGET_MS) {
        await new Promise((resolve) => setTimeout(resolve, BURST_WAIT_MS));
        const batch = await takeQueued(from);
        if (batch.length === 0) break;
        await answer(from, profileName, batch);
      }
    } finally {
      await unlock(from);
    }

    const waiting = await queuedCount(from);
    if (waiting === 0) return;
    if (Date.now() - started >= TURN_BUDGET_MS) {
      console.warn(`[whatsapp] out of time with ${waiting} message(s) waiting for …${from.slice(-4)}; answered with their next message.`);
      return;
    }
  }
}

async function answer(from: string, profileName: string, batch: Queued[]) {
  const conversation = await loadConversation(from);
  // A burst becomes ONE visitor message, lines in the order they were sent.
  const messages = trimHistory(
    withUserMessage(conversation.messages, batch.map((q) => q.text).join("\n"))
  );
  const language = languageOf(messages, DEFAULT_SITE);

  // Per TURN, not per incoming message: people send one thought across five
  // lines, and a burst is a single Claude call. Same limits as the website.
  const limited = rateLimit(`whatsapp:${from}`);
  if (limited) {
    console.warn("[whatsapp] blocked:", limited.error);
    record(whatsappMetric("blocked_rate"));
    if (await mayNotify(from, "rate")) {
      await sendText(from, language === "en" ? limited.noticeEn ?? limited.notice : limited.notice);
    }
    return;
  }

  await showTyping(batch[batch.length - 1].id);

  let turn;
  try {
    turn = await whatsappTurn(messages, conversation, from, profileName);
  } catch (error) {
    console.error("[whatsapp] Anthropic API error:", error);
    await sendText(from, FALLBACK_REPLY.plain[language]);
    // Their message is kept, so the next attempt still has it.
    await saveConversation(from, { ...conversation, messages });
    return;
  }

  const first = conversation.turns === 0;
  const delivered = await sendText(
    from,
    first ? `${WELCOME[turn.language]}\n\n${turn.reply}` : turn.reply
  );

  if (delivered) {
    // Stored WITHOUT the welcome line — the website never sends its welcome
    // to Claude either, and the directives are written for that.
    conversation.messages = [...messages, { role: "assistant", content: turn.reply }];
    conversation.turns += 1;

    const milestone = depthMetric(conversation.turns) as
      | "started"
      | "engaged"
      | "qualified"
      | null;
    if (milestone) {
      record(
        whatsappMetric(milestone),
        ...(milestone === "started" ? [whatsappMetric(`lang_${turn.language}`)] : [])
      );
    }
  } else {
    // A reply they never saw is not stored, so Claude does not think it said
    // it. Their message IS kept, and joins their next one.
    record(whatsappMetric("send_failed"));
    conversation.messages = messages;
  }

  // Saved EITHER WAY: if the lead went out during this turn, `leadSent` must
  // stick even when the reply about it failed to deliver.
  await saveConversation(from, conversation);
}
