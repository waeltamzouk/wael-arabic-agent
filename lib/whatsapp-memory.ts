// THE WHATSAPP CONVERSATION MEMORY — the real work of W8-T2.
//
// The website agent remembers because the WIDGET re-sends the whole
// conversation on every request (see "Chat widget notes" in CLAUDE.md). Meta
// sends ONE message at a time and nothing else. So on this channel the server
// keeps the conversation, in Upstash, one record per phone number, and hands
// Claude exactly the same shape of history the widget would have sent.
//
// Three problems the widget never had, and what solves each:
//
// 1. GROWTH. The widget's history is capped by the guard, which REFUSES a
//    conversation past 40 messages or 20,000 characters and tells the visitor
//    to close the tab. There is no tab on WhatsApp. So the same limits are
//    reused, but as a TRIM: the oldest exchanges fall off the front. What must
//    survive a trim — "their name was already asked", "the lead was already
//    sent", the notes Claude gathered — is kept as STATE on the record, not in
//    the text, so a trim can never make Claude ask twice.
//
// 2. PEOPLE TYPE IN BURSTS. "مرحبا" / "كم سعر الموقع؟" / "صفحة وحدة" arrive as
//    three webhooks within seconds. Answered naively, that is three parallel
//    Claude calls, three replies, and three writes to the same record where
//    the last one wins and the other two messages vanish from the memory.
//    Fix: every message goes into a per-number INBOX first, and only the
//    holder of a per-number LOCK talks to Claude. It takes everything waiting
//    in the inbox as one turn, answers, then checks the inbox again. A burst
//    becomes ONE reply to all of it, which is also what a person would do.
//
// 3. META RETRIES. A webhook Meta thinks failed is delivered again, so the same
//    message can arrive twice. Each message id is remembered for two days and
//    a repeat is dropped.
//
// PRIVACY, and it is a real change from Phase 5: until now Upstash held counts
// only. This stores message TEXT against a PHONE NUMBER. It has to — that is
// what memory is — so it expires: a conversation nobody touches for
// HISTORY_DAYS is deleted by Upstash on its own. Nothing here is ever shown on
// /stats.
//
// WITHOUT UPSTASH (local dev with no keys) the same code runs on an in-memory
// Map. It remembers only inside one server process, which is fine on a laptop
// and useless on Vercel — so it says so loudly in production.

import type { ChatMessage } from "@/lib/agent";
import { MAX_MESSAGES, MAX_MESSAGE_CHARS, MAX_TOTAL_CHARS } from "@/lib/guard";
import { pipeline, upstashEnabled } from "@/lib/upstash";

// A week of silence and the conversation is forgotten. Long enough that
// someone who asks on Monday and comes back on Thursday is still recognised —
// including "your details already reached Wael" — short enough that message
// text is not kept for months.
const HISTORY_DAYS = 7;
const HISTORY_TTL = HISTORY_DAYS * 24 * 60 * 60;

// Meta retries a delivery for up to a day or so. Two days covers it.
const SEEN_TTL = 2 * 24 * 60 * 60;

// The lock outlives the longest possible turn (the route's maxDuration is 60s)
// so a crashed run can never hold a number hostage for more than a minute.
const LOCK_TTL = 60;

// Unanswered messages older than this are not worth answering as a batch.
const INBOX_TTL = 60 * 60;

// One burst is a handful of lines. Anything beyond this in one turn is not a
// person typing.
const MAX_BATCH = 20;

export type Notes = Record<string, string>;

export type Conversation = {
  // Plain text only, alternating user / assistant, exactly the shape the
  // widget sends. The tool calls are NOT stored — same as the website — which
  // is why the state below exists.
  messages: ChatMessage[];
  // Visitor turns answered in this conversation. Drives the funnel counters,
  // and is the ONLY thing they read: counting messages in the history would
  // break the first time a trim shortened it (see "The milestone parity bug").
  turns: number;
  // request_contact fired, i.e. the agent asked for their name.
  asked: boolean;
  // The notes Claude passed to request_contact, kept until send_lead needs them.
  notes: Notes;
  // A lead email went out for this conversation. Never send a second.
  leadSent: boolean;
};

export function emptyConversation(): Conversation {
  return { messages: [], turns: 0, asked: false, notes: {}, leadSent: false };
}

// ---------------------------------------------------------------------------
// Storage: Upstash in production, a Map on a laptop. Same six operations.
// ---------------------------------------------------------------------------

type Kv = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl: number): Promise<void>;
  // SET NX: true only for the FIRST caller. The lock and the dedupe are both this.
  claim(key: string, ttl: number): Promise<boolean>;
  del(key: string): Promise<void>;
  push(key: string, value: string, ttl: number): Promise<void>;
  // Takes up to `max` items off the front of a list, atomically — two callers
  // can never both get the same message.
  take(key: string, max: number): Promise<string[]>;
  size(key: string): Promise<number>;
};

async function one(command: unknown[]): Promise<unknown> {
  return (await pipeline([command]))[0];
}

const upstash: Kv = {
  async get(key) {
    const value = await one(["GET", key]);
    return typeof value === "string" ? value : null;
  },
  async set(key, value, ttl) {
    await one(["SET", key, value, "EX", ttl]);
  },
  async claim(key, ttl) {
    return (await one(["SET", key, "1", "NX", "EX", ttl])) === "OK";
  },
  async del(key) {
    await one(["DEL", key]);
  },
  async push(key, value, ttl) {
    await pipeline([
      ["RPUSH", key, value],
      ["EXPIRE", key, ttl],
    ]);
  },
  async take(key, max) {
    const value = await one(["LPOP", key, max]);
    return Array.isArray(value) ? value.map(String) : [];
  },
  async size(key) {
    return Number(await one(["LLEN", key])) || 0;
  },
};

const local = new Map<string, { value: string | string[]; expires: number }>();

function alive(key: string) {
  const entry = local.get(key);
  if (entry && entry.expires < Date.now()) local.delete(key);
  return local.get(key);
}

const memory: Kv = {
  async get(key) {
    const value = alive(key)?.value;
    return typeof value === "string" ? value : null;
  },
  async set(key, value, ttl) {
    local.set(key, { value, expires: Date.now() + ttl * 1000 });
  },
  async claim(key, ttl) {
    if (alive(key)) return false;
    local.set(key, { value: "1", expires: Date.now() + ttl * 1000 });
    return true;
  },
  async del(key) {
    local.delete(key);
  },
  async push(key, value, ttl) {
    const current = alive(key)?.value;
    const items = Array.isArray(current) ? current : [];
    local.set(key, { value: [...items, value], expires: Date.now() + ttl * 1000 });
  },
  async take(key, max) {
    const entry = alive(key);
    if (!entry || !Array.isArray(entry.value)) return [];
    const taken = entry.value.slice(0, max);
    entry.value = entry.value.slice(max);
    return taken;
  },
  async size(key) {
    const value = alive(key)?.value;
    return Array.isArray(value) ? value.length : 0;
  },
};

let warned = false;

function kv(): Kv {
  if (upstashEnabled()) return upstash;
  if (!warned && process.env.NODE_ENV === "production") {
    console.error(
      "[whatsapp] UPSTASH_REDIS_REST_URL / _TOKEN are not set, so WhatsApp conversations are only remembered inside one server instance. On Vercel that means the agent forgets between messages. Set both in the Vercel project settings."
    );
    warned = true;
  }
  return memory;
}

// Keys are per phone number. `from` is digits only by the time it gets here
// (lib/whatsapp-cloud.ts strips everything else), so nothing can escape a key.
const keys = {
  conversation: (from: string) => `wa:chat:${from}`,
  inbox: (from: string) => `wa:inbox:${from}`,
  lock: (from: string) => `wa:lock:${from}`,
  seen: (id: string) => `wa:seen:${id}`,
  noticed: (from: string, what: string) => `wa:notice:${what}:${from}`,
};

// ---------------------------------------------------------------------------
// The conversation record
// ---------------------------------------------------------------------------

function isMessage(value: unknown): value is ChatMessage {
  const m = value as ChatMessage;
  return (
    typeof m === "object" &&
    m !== null &&
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string"
  );
}

export async function loadConversation(from: string): Promise<Conversation> {
  const raw = await kv().get(keys.conversation(from));
  if (!raw) return emptyConversation();

  try {
    const parsed = JSON.parse(raw) as Partial<Conversation>;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages.filter(isMessage) : [],
      turns: Number(parsed.turns) || 0,
      asked: parsed.asked === true,
      notes: typeof parsed.notes === "object" && parsed.notes ? parsed.notes : {},
      leadSent: parsed.leadSent === true,
    };
  } catch {
    // A record that cannot be read is treated as a new conversation, not an
    // error: the person still gets an answer, just without the memory.
    console.error(`[whatsapp] unreadable conversation record for …${from.slice(-4)}, starting fresh.`);
    return emptyConversation();
  }
}

/** Saves the record and restarts its HISTORY_DAYS clock. */
export async function saveConversation(from: string, conversation: Conversation) {
  await kv().set(keys.conversation(from), JSON.stringify(conversation), HISTORY_TTL);
}

/**
 * Adds the visitor's new text to the history. If the last stored message is
 * ALSO theirs — the previous reply failed to send, so it was never stored —
 * the two are joined into one message, which keeps the history strictly
 * alternating, the shape the widget always sends.
 */
export function withUserMessage(messages: ChatMessage[], text: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "user") {
    return [...messages.slice(0, -1), { role: "user", content: `${last.content}\n${text}` }];
  }
  return [...messages, { role: "user", content: text }];
}

/**
 * The guard's own caps, used as a trim instead of a refusal. The oldest
 * messages go first, and the history always starts with a visitor message —
 * the Messages API rejects one that starts with the assistant.
 *
 * Every message is ALSO cut to MAX_MESSAGE_CHARS first, so one enormous paste
 * cannot push the whole conversation out of the window on its own.
 */
export function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  const trimmed = messages.map((m) =>
    m.content.length > MAX_MESSAGE_CHARS
      ? { ...m, content: m.content.slice(0, MAX_MESSAGE_CHARS) }
      : m
  );

  let total = trimmed.reduce((sum, m) => sum + m.content.length, 0);
  let start = 0;

  while (
    start < trimmed.length - 1 &&
    (trimmed.length - start > MAX_MESSAGES || total > MAX_TOTAL_CHARS)
  ) {
    total -= trimmed[start].content.length;
    start++;
  }
  while (start < trimmed.length - 1 && trimmed[start].role !== "user") start++;

  return trimmed.slice(start);
}

// ---------------------------------------------------------------------------
// Inbox, lock, dedupe
// ---------------------------------------------------------------------------

/** True the FIRST time a message id is seen. A Meta retry returns false. */
export function firstDelivery(messageId: string): Promise<boolean> {
  return kv().claim(keys.seen(messageId), SEEN_TTL);
}

export type Queued = { id: string; text: string };

export function enqueue(from: string, message: Queued) {
  return kv().push(keys.inbox(from), JSON.stringify(message), INBOX_TTL);
}

export async function takeQueued(from: string): Promise<Queued[]> {
  const raw = await kv().take(keys.inbox(from), MAX_BATCH);
  const queued: Queued[] = [];
  for (const item of raw) {
    try {
      const parsed = JSON.parse(item) as Queued;
      if (typeof parsed.id === "string" && typeof parsed.text === "string") queued.push(parsed);
    } catch {}
  }
  return queued;
}

export function queuedCount(from: string) {
  return kv().size(keys.inbox(from));
}

export function lock(from: string) {
  return kv().claim(keys.lock(from), LOCK_TTL);
}

export function unlock(from: string) {
  return kv().del(keys.lock(from));
}

/**
 * True at most once a minute per number and kind of notice. Stops a flood of
 * voice notes, or someone over the rate limit, from getting one canned reply
 * per message — from Oct 1 2026 every reply Meta delivers is billed.
 */
export function mayNotify(from: string, what: string) {
  return kv().claim(keys.noticed(from, what), 60);
}
