// What stops the audit page being used to hammer other people's websites, fill
// Wael's inbox, or burn through the Resend plan.
//
// The audit costs no Claude calls, so the risks are different from /api/chat:
// not money per request, but (1) our server opening someone else's site over and
// over, (2) emails sent to addresses that never asked, (3) a daily send limit.
//
// Counted in Upstash (see kv.ts), so the numbers hold across every Vercel
// instance. lib/guard.ts's in-memory limiter does not, which is why it is not
// reused here. Windows are fixed buckets (this hour, this day, UTC): simple,
// and good enough to stop one person hammering.
//
// ORDER MATTERS. The checks run from "this one visitor" to "everyone", so a
// visitor who is already blocked cannot use up the shared daily cap.

import { createHash } from "node:crypto";
import { kvAvailable, kvIncr, kvSetIfAbsent } from "./kv.ts";

const PER_IP_HOUR = 3;
const PER_IP_DAY = 10;
const PER_EMAIL_DAY = 5;
const DEFAULT_DAILY_CAP = 100;

export type LimitResult = { ok: true } | { ok: false; reason: "ip" | "email" | "global" | "unavailable" };

const hour = () => new Date().toISOString().slice(0, 13);
const day = () => new Date().toISOString().slice(0, 10);

/** An address is never stored: only the first 16 hex characters of its hash. */
export function emailKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

function dailyCap(): number {
  const n = Number(process.env.AUDIT_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
}

export async function checkLimits(ip: string, email: string): Promise<LimitResult> {
  // Production without Upstash: refuse. A limit that silently does nothing is worse than none.
  if (!kvAvailable()) return { ok: false, reason: "unavailable" };

  try {
    if ((await kvIncr(`audit:rl:ip:h:${ip}:${hour()}`, 2 * 3600)) > PER_IP_HOUR) return { ok: false, reason: "ip" };
    if ((await kvIncr(`audit:rl:ip:d:${ip}:${day()}`, 2 * 86400)) > PER_IP_DAY) return { ok: false, reason: "ip" };
    if ((await kvIncr(`audit:rl:em:${emailKey(email)}:${day()}`, 2 * 86400)) > PER_EMAIL_DAY) return { ok: false, reason: "email" };
    if ((await kvIncr(`audit:rl:global:${day()}`, 2 * 86400)) > dailyCap()) return { ok: false, reason: "global" };
    return { ok: true };
  } catch (error) {
    console.error("Audit limit check failed, refusing the request:", error);
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * True the first time an address is mailed a report today. The report email goes
 * to a stranger-supplied address, so each address gets at most one a day: the
 * form cannot be used to flood somebody's inbox.
 */
export async function mayEmailReport(email: string): Promise<boolean> {
  try {
    return await kvSetIfAbsent(`audit:mail:${emailKey(email)}:${day()}`, "1", 2 * 86400);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- the address itself

// Deliberately loose, like /api/lead: a strict address regex rejects real
// addresses, and a typo that slips through only costs one bounced email.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "10minutemail.com", "tempmail.com", "temp-mail.org",
  "yopmail.com", "trashmail.com", "getnada.com", "sharklasers.com", "throwawaymail.com", "maildrop.cc",
  "dispostable.com", "fakeinbox.com", "moakt.com", "mintemail.com", "mohmal.com", "tempail.com", "emailondeck.com",
]);

export function emailProblem(raw: string): "shape" | "disposable" | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 200 || !EMAIL_SHAPE.test(email)) return "shape";
  return DISPOSABLE.has(email.split("@")[1]) ? "disposable" : null;
}
