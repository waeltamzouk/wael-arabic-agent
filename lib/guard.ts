// Everything that stops /api/chat being a free Claude API for the whole
// internet. Called at the top of the route, BEFORE any Anthropic call, so an
// abusive request costs nothing.
//
// Three layers, each stopping something different:
//   1. Origin allowlist  — stops another site bolting this agent onto its page
//   2. Rate limit        — caps how fast one visitor can burn the API budget
//   3. Size caps         — stops one huge request costing a fortune
//
// Failures return { status, error, notice }. `error` is English, for the logs
// and for us. `notice` is Arabic and is the only part a visitor ever sees.

import type { NextRequest } from "next/server";

export type GuardFailure = {
  status: number;
  error: string;
  notice: string;
  // The same notice for the English templates site. Optional so the lead
  // route's own Arabic-only failures need no change; the chat route falls back
  // to a generic English line when it is missing.
  noticeEn?: string;
};

// ---------------------------------------------------------------------------
// 1. Origin allowlist
// ---------------------------------------------------------------------------

// The live site. Anything else has to be added through the ALLOWED_ORIGINS env
// var in Vercel, so adding a domain never needs a deploy.
const SITE_ORIGINS = [
  "https://waelwebdesign.com",
  "https://www.waelwebdesign.com",
  // The English templates site. Needed for the "opened" beacon, which is sent
  // from the Framer page itself, not from inside the iframe.
  "https://waeltamzouk.framer.ai",
];

function isDev() {
  return process.env.NODE_ENV !== "production";
}

function allowedOrigins(): string[] {
  const extra = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  const list = [...SITE_ORIGINS, ...extra];

  if (isDev()) {
    list.push("http://localhost:3000", "http://127.0.0.1:3000");
  }

  return list;
}

/**
 * True when this request is allowed to talk to the route.
 *
 * Browsers always send `Origin` on a POST, so requiring it in production is
 * safe for the widget. It also means a production curl test needs
 * `-H "Origin: https://waelwebdesign.com"` — see CLAUDE.md.
 *
 * NOTE: `Origin` is trivial to fake outside a browser. This layer stops other
 * SITES from using the agent. The rate limit below is what caps the bill.
 */
export function isAllowedOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");

  // No Origin means it is not a browser: curl, a script, a server. Allowed in
  // dev so terminal testing keeps working, refused in production.
  if (!origin) return isDev();

  // Same-origin is always fine. This is how the iframe at /embed talks to the
  // route, and it covers every Vercel preview deployment without listing them.
  const host = req.headers.get("host");
  try {
    if (host && new URL(origin).host === host) return true;
  } catch {
    return false; // Malformed Origin header.
  }

  return allowedOrigins().includes(origin.replace(/\/+$/, ""));
}

/**
 * CORS response headers. Only ever echoes back an origin that already passed
 * the allowlist, so this grants nothing the check above would refuse.
 *
 * The iframe does not need these — it is same-origin. They exist so the widget
 * can also be loaded directly on waelwebdesign.com later, with no iframe.
 */
export function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");

  if (!origin || !isAllowedOrigin(req)) {
    // Vary still matters: it stops a CDN caching one visitor's CORS answer and
    // serving it to a visitor from a different origin.
    return { Vary: "Origin" };
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// ---------------------------------------------------------------------------
// 2. Rate limit
// ---------------------------------------------------------------------------

const MAX_PER_MINUTE = 10;
const MAX_PER_HOUR = 50;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Timestamps of recent requests, keyed by IP.
//
// GOTCHA, and it is a real limitation: this Map lives in ONE serverless
// instance's memory. Vercel runs several, and each gets its own copy, so the
// true ceiling is roughly the limit multiplied by the number of live
// instances. It also empties on a cold start. It stops one person hammering
// the route, which is the actual risk here; it is not an exact guarantee.
// Upgrade path if traffic ever justifies it: Upstash Redis, same function
// signature, nothing else in the codebase changes.
const hits = new Map<string, number[]>();

// Stop the Map growing forever on a long-lived instance.
const MAX_TRACKED_IPS = 10_000;

function prune(now: number) {
  for (const [ip, times] of hits) {
    const recent = times.filter((t) => now - t < HOUR);
    if (recent.length === 0) hits.delete(ip);
    else hits.set(ip, recent);
  }
}

/** The visitor's IP. Vercel sets x-forwarded-for; the first entry is the client. */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function rateLimit(ip: string): GuardFailure | null {
  const now = Date.now();

  if (hits.size > MAX_TRACKED_IPS) prune(now);

  const recent = (hits.get(ip) ?? []).filter((t) => now - t < HOUR);
  const lastMinute = recent.filter((t) => now - t < MINUTE).length;

  const overHour = recent.length >= MAX_PER_HOUR;
  const overMinute = lastMinute >= MAX_PER_MINUTE;

  if (overHour || overMinute) {
    // Record nothing: a blocked request must not push its own limit further out.
    hits.set(ip, recent);

    // The hourly limit is checked FIRST and has its own notice. Telling someone
    // who has burnt the hourly budget to "wait a minute" is simply wrong — a
    // minute does nothing, and they come back to the same wall.
    return overHour
      ? {
          status: 429,
          error: `Rate limit exceeded (hourly) for ${ip}.`,
          notice:
            "وصلت للحد الأقصى من الرسائل لهذه الساعة. جرّب بعد شوي، أو تواصل مع وائل مباشرة على https://waelwebdesign.com/contact",
          noticeEn:
            "You have reached the message limit for this hour. Please try again later.",
        }
      : {
          status: 429,
          error: `Rate limit exceeded (per minute) for ${ip}.`,
          notice: "رسائل كثيرة في وقت قصير. انتظر دقيقة ثم حاول مرة أخرى.",
          noticeEn: "Too many messages in a short time. Wait a minute and try again.",
        };
  }

  recent.push(now);
  hits.set(ip, recent);
  return null;
}

// ---------------------------------------------------------------------------
// 3. Size caps
// ---------------------------------------------------------------------------

// The widget re-sends the WHOLE conversation on every request — that is how
// Claude remembers it. So cost grows with the square of the conversation, and
// one request carrying 5,000 fake messages would be a single enormous bill.
// These caps are generous for a real conversation (15-20 messages) and cheap
// to check.
export const MAX_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 2_000;
export const MAX_TOTAL_CHARS = 20_000;

// GOTCHA, and this notice was WRONG until Sep 22: it used to say "حدّث الصفحة"
// — refresh the page. That was true when it was written, but Phase 3 added
// sessionStorage persistence, so a refresh RESTORES the same oversized
// conversation and the visitor is stuck in a loop with no way out. Only closing
// the tab clears it. Say the thing that actually works.
const TOO_LONG_NOTICE =
  "المحادثة طويلة جداً. أغلق التبويب وافتح الموقع من جديد لتبدأ محادثة جديدة، أو تواصل مع وائل على https://waelwebdesign.com/contact";
const TOO_LONG_NOTICE_EN =
  "This conversation is too long. Close the tab and open the site again to start a new one.";

export function checkSize(
  messages: { content: string }[]
): GuardFailure | null {
  if (messages.length > MAX_MESSAGES) {
    return {
      status: 413,
      error: `Too many messages: ${messages.length} (max ${MAX_MESSAGES}).`,
      notice: TOO_LONG_NOTICE,
      noticeEn: TOO_LONG_NOTICE_EN,
    };
  }

  let total = 0;

  for (const message of messages) {
    if (message.content.length > MAX_MESSAGE_CHARS) {
      return {
        status: 413,
        error: `Message too long: ${message.content.length} chars (max ${MAX_MESSAGE_CHARS}).`,
        notice: "الرسالة طويلة جداً. اختصرها وحاول مرة أخرى.",
        noticeEn: "That message is too long. Shorten it and try again.",
      };
    }
    total += message.content.length;
  }

  if (total > MAX_TOTAL_CHARS) {
    return {
      status: 413,
      error: `Conversation too long: ${total} chars (max ${MAX_TOTAL_CHARS}).`,
      notice: TOO_LONG_NOTICE,
      noticeEn: TOO_LONG_NOTICE_EN,
    };
  }

  return null;
}
