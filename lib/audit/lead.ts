// Putting an audit visitor on Wael's list, and telling Wael.
//
// The adding itself is `addBuyer` from lib/mailing-list.ts, reused AS IS: it looks
// the address up account-wide before creating it, so a person who once unsubscribed
// is never silently resubscribed by asking for an audit. That behaviour was found
// the hard way (CLAUDE.md, "Polar buyers -> mailing list"); do not replace it with
// a plain `contacts.create`.
//
// DRY RUN. AUDIT_DRY_RUN=1 (ignored in production) logs what would be sent or added
// and touches nothing, so the whole flow can be tested without emailing a stranger
// or filling the real list with test addresses.

import { Resend } from "resend";
import { addBuyer, type Outcome } from "../mailing-list.ts";

export const dryRun = () => process.env.NODE_ENV !== "production" && process.env.AUDIT_DRY_RUN === "1";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resend allows 2 requests a second per key. Space consecutive calls out. */
export const RESEND_PACE_MS = 600;

export async function saveLead(lead: { email: string; name: string; domain: string }): Promise<Outcome> {
  if (dryRun()) {
    console.log(`[audit:dry-run] would add ${lead.email} (${lead.domain}) to RESEND_AUDIENCE_ID_AUDIT`);
    return "disabled";
  }
  return addBuyer({
    email: lead.email,
    name: lead.name,
    audienceId: process.env.RESEND_AUDIENCE_ID_AUDIT,
    source: "audit",
    // `language` is an existing contact property; the audit page is Arabic. `template`
    // is left empty on purpose, so "everyone who bought a template" never includes audit leads.
    list: "ar",
    properties: { website: lead.domain },
  });
}

/**
 * Add the score to the contact once the audit has finished. A separate, best-effort
 * step: the lead is already saved, and if this fails the contact simply has no score.
 * `audit_score` must be defined in Resend (Audience -> Properties) or it is ignored.
 */
export async function saveScore(email: string, score: number | null): Promise<void> {
  if (score === null) return;
  if (dryRun()) {
    console.log(`[audit:dry-run] would set audit_score=${score} on ${email}`);
    return;
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !process.env.RESEND_AUDIENCE_ID_AUDIT) return;
  try {
    const { error } = await new Resend(apiKey).contacts.update({ email, properties: { audit_score: String(score) } });
    if (error) console.error(`audit_score not saved (${error.name}): ${error.message}`);
  } catch (error) {
    console.error("Resend threw while saving audit_score:", error);
  }
}
