// Funnel counters. Answers the one question the lead email cannot: what
// happens to everyone who does NOT finish and hand over a phone number.
//
// Two deliberate choices:
//
// 1. NO new dependency. Upstash has a plain REST API, so `fetch` is enough and
//    the project stays on three runtime deps. Upstash was already named in
//    CLAUDE.md as the upgrade path for the rate limiter, so this is the
//    service the project had already chosen.
//
// 2. NO session IDs, NO cookies, NO visitor tracking. The widget re-sends the
//    WHOLE history on every request, so `messages.length` IS the conversation
//    depth. A conversation is counted at a milestone by testing for EXACT
//    equality with a length it can only pass through once — see `depthMetric`.
//    Nothing needs to be correlated across requests and nothing personal is
//    ever stored. Only counts go to Upstash: no names, phones or message text.

import { after } from "next/server";

// Normalised, because the value gets copied out of a dashboard by hand and the
// three ways it usually arrives wrong all produce the same unhelpful failure:
// a trailing slash (which makes the request path "//pipeline"), and a bare
// host with no scheme (which makes `fetch` throw on an invalid URL).
function restUrl(): string | undefined {
  const raw = process.env.UPSTASH_REDIS_REST_URL?.trim();
  if (!raw) return undefined;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

const REST_URL = restUrl();
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

// Daily keys expire so the free tier never fills up. 90 days is far more
// history than anyone will look at.
const TTL_SECONDS = 90 * 24 * 60 * 60;

export function statsEnabled(): boolean {
  return Boolean(REST_URL && REST_TOKEN);
}

/**
 * The day a visitor would call "today". Riyadh, not UTC — a conversation at
 * 1am Gulf time belongs to that day, not the previous one.
 */
export function statsDay(date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which sorts correctly as a string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
  }).format(date);
}

export function lastDays(count: number): string[] {
  const days: string[] = [];
  for (let i = 0; i < count; i++) {
    days.push(statsDay(new Date(Date.now() - i * 24 * 60 * 60 * 1000)));
  }
  return days;
}

export class UpstashError extends Error {
  constructor(readonly status: number) {
    super(`Upstash request failed with ${status}`);
    this.name = "UpstashError";
  }
}

/** What a given failure most likely means, in words Wael can act on. */
export function upstashHint(error: unknown): string {
  const status = error instanceof UpstashError ? error.status : 0;
  if (status === 401 || status === 403) {
    return "Upstash rejected the token. UPSTASH_REDIS_REST_TOKEN is probably wrong — copy the REST token again, not the database password.";
  }
  if (status === 404) {
    return "Upstash did not recognise that address. UPSTASH_REDIS_REST_URL should be the REST URL from the dashboard, the https:// one — not the redis:// connection string.";
  }
  if (status) return `Upstash answered ${status}.`;
  return "Could not reach Upstash at all. Check UPSTASH_REDIS_REST_URL is the https:// REST URL from the dashboard.";
}

async function pipeline(commands: unknown[][]): Promise<unknown[]> {
  const res = await fetch(`${REST_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });

  if (!res.ok) {
    // The body can echo back request details, so it goes to the server log and
    // never to the page. Only the status travels, which is what identifies the
    // problem anyway: 401 is a bad token, 404 a bad URL.
    console.error(`Upstash ${res.status}:`, await res.text());
    throw new UpstashError(res.status);
  }

  // A pipeline can return 200 with per-command errors, so a failed counter
  // would otherwise vanish silently. Log them; still return what did work.
  const body: { result?: unknown; error?: string }[] = await res.json();

  for (const entry of body) {
    if (entry.error) console.error("Upstash command failed:", entry.error);
  }

  return body.map((entry) => entry.result ?? null);
}

/**
 * Count one or more metrics for today.
 *
 * Always logs, so the funnel is readable in the Vercel logs even before
 * Upstash is configured. Never throws and never blocks the reply: the write
 * runs in `after()`, so the visitor's answer is already on its way. A failed
 * counter must never cost someone their conversation.
 */
export function record(...metrics: string[]) {
  if (metrics.length === 0) return;

  console.log(`[funnel] ${metrics.join(" ")}`);

  if (!statsEnabled()) return;

  const day = statsDay();
  const commands: unknown[][] = [];

  for (const metric of metrics) {
    const key = `chat:${day}:${metric}`;
    commands.push(["INCR", key]);
    commands.push(["EXPIRE", key, TTL_SECONDS]);
    commands.push(["INCR", `chat:total:${metric}`]);
  }

  after(async () => {
    try {
      await pipeline(commands);
    } catch (error) {
      console.error("Funnel counter failed (ignored):", error);
    }
  });
}

/**
 * Milestones, by exact conversation length.
 *
 * The widget always sends an ODD number of messages — the visitor's new line is
 * last — so a conversation passes through 1, 3, 5, 7 … exactly once each.
 * Testing for equality is what makes this count each conversation once without
 * storing anything about it. Incrementing on every request instead would count
 * one 7-turn conversation seven times.
 *
 *   1  → they sent a first message at all
 *   5  → three exchanges deep, past the opening question
 *   11 → six exchanges deep, which is roughly the qualifying questions done
 *
 * CAVEAT: a visitor who retries a failed request at the same length is counted
 * twice at that milestone. Retries are rare and this is a trend, not an audit.
 */
export function depthMetric(messageCount: number): string | null {
  if (messageCount === 1) return "started";
  if (messageCount === 5) return "engaged";
  if (messageCount === 11) return "qualified";
  return null;
}

export type Totals = Record<string, number>;

/** Reads the counters back for the stats page. */
export async function readTotals(
  days: string[],
  metrics: string[]
): Promise<{ byDay: Record<string, Totals>; overall: Totals }> {
  if (!statsEnabled()) return { byDay: {}, overall: {} };

  const commands: unknown[][] = [];
  for (const day of days) {
    for (const metric of metrics) commands.push(["GET", `chat:${day}:${metric}`]);
  }
  for (const metric of metrics) commands.push(["GET", `chat:total:${metric}`]);

  const results = await pipeline(commands);

  const byDay: Record<string, Totals> = {};
  let cursor = 0;

  for (const day of days) {
    const totals: Totals = {};
    for (const metric of metrics) {
      totals[metric] = Number(results[cursor++] ?? 0);
    }
    byDay[day] = totals;
  }

  const overall: Totals = {};
  for (const metric of metrics) {
    overall[metric] = Number(results[cursor++] ?? 0);
  }

  return { byDay, overall };
}

// Every metric the app writes, in the order the funnel happens. Kept here so
// the stats page and the writers cannot drift apart.
//
// The `buyer_*` and `polar_refused` counters are NOT part of the chat funnel —
// they come from `/api/polar`, which no visitor ever touches. They share this
// list because they share the storage and the page, and a second mechanism for
// four counters would be the thing that drifts.
export const METRICS = [
  "opened",
  "started",
  "engaged",
  "qualified",
  "lead_project",
  "lead_template",
  "lang_ar",
  "lang_en",
  "blocked_origin",
  "blocked_rate",
  "blocked_size",
  "buyer_added",
  "buyer_duplicate",
  "buyer_no_consent",
  "buyer_failed",
  "polar_refused",
] as const;
