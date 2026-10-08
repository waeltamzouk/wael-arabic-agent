// The audit's small key-value store: Upstash in production, a Map in dev.
//
// WHY NOT JUST A MAP EVERYWHERE. On Vercel several copies of this code run at
// once, each with its own memory. A visitor's audit started in one copy would
// not exist in the copy that answers the next poll, and a rate limit would be
// counted separately by each copy. That is the limitation lib/guard.ts already
// documents for the chat. The audit needs real shared storage, and Upstash is
// already in the project (lib/upstash.ts).
//
// So: with Upstash configured, use it. Without it, a Map in DEV only. In
// production without Upstash `kvAvailable()` is false and the routes refuse,
// instead of quietly using a store that cannot work.

import { pipeline, upstashEnabled } from "../upstash.ts";

const memory = new Map<string, { value: string; expires: number }>();

const devFallback = () => process.env.NODE_ENV !== "production";

export function kvAvailable(): boolean {
  return upstashEnabled() || devFallback();
}

/**
 * The rule enforced at the bottom, not only in limits.ts: in production without
 * Upstash every operation THROWS. Otherwise a future caller that forgot to ask
 * `kvAvailable()` would silently keep jobs and rate-limit counters in one
 * instance's memory, which looks like it works and does not.
 */
function inMemory(): boolean {
  if (upstashEnabled()) return false;
  if (!devFallback()) throw new Error("Upstash is not configured: the audit store is unavailable in production without it.");
  return true;
}

function live(key: string): string | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

export async function kvGet(key: string): Promise<string | null> {
  if (inMemory()) return live(key);
  const [value] = await pipeline([["GET", key]]);
  return typeof value === "string" ? value : null;
}

export async function kvSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (inMemory()) {
    memory.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    return;
  }
  await pipeline([["SET", key, value, "EX", ttlSeconds]]);
}

export async function kvDel(key: string): Promise<void> {
  if (inMemory()) {
    memory.delete(key);
    return;
  }
  await pipeline([["DEL", key]]);
}

/** Set only if absent. True when this call created it (so: "first time today"). */
export async function kvSetIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  if (inMemory()) {
    if (live(key) !== null) return false;
    memory.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    return true;
  }
  const [result] = await pipeline([["SET", key, value, "EX", ttlSeconds, "NX"]]);
  return result === "OK";
}

/**
 * Add one to a counter and return the new total. The window starts at the
 * FIRST hit and the key then expires by itself: `SET ... NX` creates it with a
 * lifetime only if it does not exist yet, and `INCR` keeps that lifetime. Two
 * commands in one round trip, and no key can ever be left without an expiry.
 */
export async function kvIncr(key: string, ttlSeconds: number): Promise<number> {
  if (inMemory()) {
    const next = Number(live(key) ?? 0) + 1;
    const entry = memory.get(key);
    memory.set(key, { value: String(next), expires: entry?.expires ?? Date.now() + ttlSeconds * 1000 });
    return next;
  }
  const result = await pipeline([
    ["SET", key, 0, "EX", ttlSeconds, "NX"],
    ["INCR", key],
  ]);
  return Number(result[1]);
}
