// Adding a buyer to the Resend Audience that new-template announcements go to.
//
// Shaped deliberately like `lib/send-lead.ts`: same Resend dependency, client
// built inside the function and not at module top level (the constructor
// throws on a missing key), every failure logged and swallowed, and a return
// value the caller can count instead of an exception it has to catch.
//
// WHAT MAKES THE UNSUBSCRIBE LINK WORK, because it is not this file:
// contacts live in an AUDIENCE, and Resend generates a per-contact unsubscribe
// URL for anything sent to that audience. The announcement itself must then
// carry `{{{RESEND_UNSUBSCRIBE_URL}}}` — three braces — in its body. Resend
// does NOT insert it for you.
//
// THE TRAP: if the broadcast has no audience attached, that variable resolves
// to an EMPTY STRING. The email sends, looks fine, and the unsubscribe link is
// a dead `href=""`. Nothing warns you. Send every announcement to the audience
// and click the link in the test send before sending it to everyone.

import { Resend } from "resend";

export type Buyer = {
  email: string;
  /** Full name as Polar has it. Split into first/last for Resend. */
  name?: string;
  /** For the log only: which order put them here. */
  orderId?: string;
};

export type Outcome =
  /** New contact, subscribed. */
  | "added"
  /** Already in the audience. Left exactly as it was. */
  | "already"
  /** No audience configured — the feature is off. */
  | "disabled"
  /** Resend said no. Logged, swallowed, buyer not added. */
  | "failed";

function splitName(name?: string): { firstName?: string; lastName?: string } {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return {};
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ") || undefined,
  };
}

/**
 * Add one buyer to the audience. Never throws.
 *
 * READ BEFORE THE OBVIOUS SIMPLIFICATION. This looks up the contact before
 * creating it, and skipping straight to `create` is wrong twice over:
 *
 *  1. Resend does not document what `create` does to an email that is already
 *     in the audience — error, or update. Both are plausible and the
 *     behaviour is not ours to rely on. Looking first makes the answer ours.
 *  2. If it updates, it updates `unsubscribed` too. A buyer who unsubscribed
 *     in March and buys a second template in June would be silently
 *     resubscribed by their own purchase. That is the one failure here with a
 *     legal edge, and it is invisible until someone complains.
 *
 * So: found, in ANY state, means leave them alone. Their unsubscribe stays
 * theirs. Only a contact that is genuinely absent gets created.
 */
export async function addBuyer(buyer: Buyer): Promise<Outcome> {
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID?.trim();

  if (!apiKey || !audienceId) {
    console.error(
      "Buyer not added: RESEND_API_KEY or RESEND_AUDIENCE_ID is missing. The audience id is on https://resend.com/audiences — it is a UUID, not the audience's name."
    );
    return "disabled";
  }

  const email = buyer.email.trim().toLowerCase();

  try {
    const resend = new Resend(apiKey);

    const existing = await resend.contacts.get({ email, audienceId });

    if (existing.data) {
      console.log(
        `[mailing-list] already subscribed (unsubscribed=${existing.data.unsubscribed}), left untouched — order ${buyer.orderId ?? "?"}`
      );
      return "already";
    }

    // `not_found` is the ONLY error that means "go ahead and create". Anything
    // else — a bad key, a rate limit, Resend having a bad afternoon — is an
    // unknown state, and creating on an unknown state is exactly how you
    // resurrect an unsubscribe. Losing one subscriber to a logged failure is
    // the cheaper mistake, and the log line below has the address in it so it
    // can be added by hand.
    if (existing.error && existing.error.name !== "not_found") {
      console.error(
        `Buyer lookup failed, not added (${existing.error.name}): ${existing.error.message} — add ${email} by hand if this keeps happening.`
      );
      return "failed";
    }

    const created = await resend.contacts.create({
      audienceId,
      email,
      ...splitName(buyer.name),
      // Sent explicitly rather than left to default. There is a known Resend
      // bug where an omitted value lands as unsubscribed, and a contact that
      // silently arrives unsubscribed is a mailing list that quietly does
      // nothing. Safe here precisely because the lookup above proved this
      // address is not already in the audience with a choice of its own.
      unsubscribed: false,
    });

    if (created.error) {
      console.error(
        `Buyer not added (${created.error.name}): ${created.error.message} — ${email}`
      );
      return "failed";
    }

    console.log(`[mailing-list] added ${email} — order ${buyer.orderId ?? "?"}`);
    return "added";
  } catch (error) {
    console.error("Resend threw while adding a buyer:", error);
    return "failed";
  }
}
