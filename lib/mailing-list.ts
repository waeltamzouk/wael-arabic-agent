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
  /** Which audience to add them to. The caller decides — see `audienceFor`. */
  audienceId?: string;
  /** The template they bought. Stored on the contact so it can be filtered on later. */
  product?: string;
  /** Where they came from: "polar" (a purchase) or "chat" (the discount code). Defaults to "polar". */
  source?: "polar" | "chat";
  /** For the log only: which order put them here, and which list it chose. */
  orderId?: string;
  list?: string;
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
  const audienceId = buyer.audienceId;

  if (!apiKey || !audienceId) {
    console.error(
      `Buyer not added: RESEND_API_KEY or the ${buyer.list === "en" ? "RESEND_AUDIENCE_ID_EN" : "RESEND_AUDIENCE_ID"} audience id is missing. The id is on https://resend.com/audiences — a UUID, not the audience's name.`
    );
    return "disabled";
  }

  const email = buyer.email.trim().toLowerCase();

  try {
    const resend = new Resend(apiKey);

    // THE LOOKUP IS DELIBERATELY NOT SCOPED TO THE AUDIENCE, and getting this
    // wrong reopens the exact hole this function exists to close.
    //
    // Resend has moved to ACCOUNT-LEVEL contacts: an audience is now a segment
    // over them, and `unsubscribed` belongs to the CONTACT, not to their
    // membership of a segment. So someone can be unsubscribed account-wide and
    // still be absent from this segment — and an audience-scoped lookup
    // answers `not_found` for them. Create on that answer and you have just
    // resubscribed a person who opted out, silently, because they bought a
    // second template. Verified against the live API on Sep 22.
    //
    // Looking them up account-wide is what makes an unsubscribe stick.
    const existing = await resend.contacts.get({ email });

    if (existing.data?.unsubscribed) {
      // The whole point. They opted out; a purchase does not undo that.
      console.log(
        `[mailing-list] ${email} unsubscribed previously — left alone, order ${buyer.orderId ?? "?"}`
      );
      return "already";
    }

    if (existing.data) {
      // Known and still subscribed. They may or may not be in THIS audience —
      // a buyer of an Arabic template who now buys an English one is a real
      // case. `create` below adds them to it, and passing `unsubscribed: false`
      // for someone already subscribed changes nothing.
      const inAudience = await resend.contacts.get({ email, audienceId });

      if (inAudience.data) {
        console.log(
          `[mailing-list] already in this audience, left untouched — order ${buyer.orderId ?? "?"}`
        );
        return "already";
      }
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
      // WRITTEN NOW BECAUSE IT CANNOT BE RECOVERED LATER. Which template
      // someone bought exists only in the webhook that is being handled right
      // now; once the contact is saved without it, that fact is gone for good
      // and no amount of later work brings it back. It costs one field here
      // and it is what makes "everyone who bought a blog template" a segment
      // Wael can build himself in Resend, instead of a code change.
      //
      // The three keys are defined account-wide in Resend (Audience →
      // Properties). Sending a key that is not defined there is ignored, so a
      // typo here fails SILENTLY — check the contact after changing them.
      properties: {
        language: buyer.list ?? "",
        template: buyer.product ?? "",
        source: buyer.source ?? "polar",
      },
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

    console.log(`[mailing-list] added ${email} to the ${buyer.list ?? "?"} list (${buyer.product ?? "no product"}) — order ${buyer.orderId ?? "?"}`);
    return "added";
  } catch (error) {
    console.error("Resend threw while adding a buyer:", error);
    return "failed";
  }
}
