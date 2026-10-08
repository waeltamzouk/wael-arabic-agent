// A test switch, so Wael can try the live chat without adding to his own
// numbers. Every test conversation used to look exactly like a real visitor.
//
// HOW IT WORKS. Open the chat with `?test=<STATS_KEY>` on the link (for example
// `/embed?test=…`). The widget remembers the key for that tab and sends it with
// every request as the `x-test-key` header. A request whose key matches
// STATS_KEY runs in TEST MODE:
//   - no funnel counter is written (see `record` in lib/stats.ts),
//   - a lead email still goes out, but its subject starts with [TEST].
// A wrong or missing key changes nothing — the request is simply a normal one.
// STATS_KEY is reused on purpose: it is already the key to the stats page, so
// there is no second secret to set up or leak.
//
// WHAT IT CANNOT COVER: WhatsApp (Meta's webhook cannot carry the header), and
// the "opened" ping the Framer snippet sends from waelwebdesign.com. A test on
// the Framer site itself still counts; test through `/embed?test=…` instead.
//
// Mechanism: AsyncLocalStorage, so `record()` can ask "is this request a test?"
// from anywhere in the call stack without every route threading a flag through.

import { AsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual } from "node:crypto";

export const TEST_HEADER = "x-test-key";

const store = new AsyncLocalStorage<true>();

/** True when this request carries the right test key. */
export function isTestRequest(req: Request): boolean {
  const expected = process.env.STATS_KEY?.trim();
  const given = req.headers.get(TEST_HEADER)?.trim();
  if (!expected || !given) return false;

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True while running inside a request that passed `runInTestMode`. */
export function inTestMode(): boolean {
  return store.getStore() === true;
}

/** Runs a route handler, in test mode when the request carries the key. */
export function runInTestMode<T>(req: Request, handler: () => Promise<T>): Promise<T> {
  return isTestRequest(req) ? store.run(true, handler) : handler();
}
