// Polar calls this when someone buys a template. It verifies the call really
// came from Polar, and if the buyer agreed to be emailed, puts them in the
// Resend Audience that new-template announcements go to.
//
// THIS ENDPOINT IS PUBLIC AND IT WRITES TO A MAILING LIST. That combination is
// found and abused, so the signature check below is not a formality — it is
// the only thing standing between this URL and a stranger stuffing an audience
// with addresses Wael would then email. There is no origin allowlist here on
// purpose: Polar is a server, it sends no Origin header, and `lib/guard.ts`
// exists to stop other WEBSITES embedding the chat. Different threat, wrong
// tool. The secret is the guard.
//
// The rules about status codes, which are not the usual ones:
//
//   403  the signature did not verify. NOT swallowed — a request we cannot
//        prove came from Polar is refused, loudly, every time.
//   400  the body is not JSON, or is too big to be a real order.
//   500  POLAR_WEBHOOK_SECRET is not configured. Nothing can be verified, so
//        nothing is processed, and Polar's retries are the alarm.
//   200  EVERYTHING ELSE, including Resend failing. Same rule as `sendLead`:
//        a mailing-list problem is logged and swallowed. Polar retries up to
//        10 times on a non-2xx and DISABLES an endpoint after 10 consecutive
//        failures, so answering 500 because Resend blinked would eventually
//        switch the whole integration off silently.
//
//   THE TRADE-OFF, stated so nobody thinks it was missed: swallowing means a
//   transient Resend error loses that buyer instead of being retried. The log
//   line carries their address so it can be fixed by hand. If that ever
//   happens more than once, the change is to return 500 for `failed` ONLY —
//   never for a refused consent, which would retry forever.

import { NextRequest, NextResponse } from "next/server";
import { addBuyer } from "@/lib/mailing-list";
import { record } from "@/lib/stats";
import {
  consentFrom,
  consentMode,
  consentSlug,
  eventType,
  isPaid,
  readOrder,
  verifyPolarSignature,
} from "@/lib/polar-webhook";

// node:crypto and the raw request body both need the Node runtime.
export const runtime = "nodejs";

// A real order payload is a few kB. This is not a security boundary — the
// signature is — it just means a junk request is rejected before anything
// hashes it.
const MAX_BODY_BYTES = 64 * 1024;

// `order.created` is what CLAUDE.md decided on, and it is kept. `order.paid`
// is listened for as well because `order.created` can arrive `pending`, before
// the card has actually been charged. Whichever one arrives PAID does the
// work; the other one falls out at the `isPaid` check below. Subscribe both in
// the Polar dashboard.
const HANDLED = new Set(["order.created", "order.paid"]);

// Answering 200 while doing nothing is the normal case here, not an error, so
// give the reason a place to live — it is the difference between "working" and
// "silently broken" when reading the Vercel logs.
function ok(reason: string) {
  return NextResponse.json({ ok: true, reason }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const secret = process.env.POLAR_WEBHOOK_SECRET?.trim();

  if (!secret) {
    console.error(
      "POLAR_WEBHOOK_SECRET is not set. Nothing can be verified, so nothing was processed. Copy the secret from the endpoint in the Polar dashboard into the Vercel project settings."
    );
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  const declared = Number(req.headers.get("content-length") ?? 0);

  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Body too large." }, { status: 400 });
  }

  // MUST be the raw text. `req.json()` re-serialises the body — different
  // whitespace, different key order — and the HMAC then never matches what
  // Polar signed. Read once, verify, parse afterwards.
  const raw = await req.text();

  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Body too large." }, { status: 400 });
  }

  const verdict = verifyPolarSignature(raw, req.headers, secret);

  if (!verdict.ok) {
    console.warn("Refused a /api/polar request:", verdict.reason);
    record("polar_refused");
    return NextResponse.json({ error: "Invalid signature." }, { status: 403 });
  }

  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const type = eventType(payload);

  // Polar sends whatever the endpoint is subscribed to, and a harmless 200 is
  // the right answer to an event we do not act on. Refusing it would count
  // against the 10 consecutive failures that disable the endpoint.
  if (!type || !HANDLED.has(type)) {
    return ok(`ignored event ${type ?? "(none)"}`);
  }

  const order = readOrder(payload);

  if (!order) {
    console.error(`Polar ${type} arrived without a readable order.`);
    return ok("unreadable order");
  }

  if (!isPaid(order)) {
    // Not a problem: `order.created` fires before the card is charged, and
    // `order.paid` follows. Ending here is the common path, not a failure.
    return ok(`order ${order.id} is not paid yet (${order.status ?? "unknown"})`);
  }

  if (!order.email) {
    console.error(`Polar order ${order.id} is paid but carries no customer email.`);
    return ok("no email on the order");
  }

  const consent = consentFrom(order);

  if (consent === "no") {
    record("buyer_no_consent");
    return ok(`order ${order.id}: buyer declined marketing`);
  }

  if (consent === "not-asked") {
    if (consentMode() === "checkbox") {
      // The whole feature lands here until the checkbox exists. Say exactly
      // what is missing — a log that only says "skipped" is how this ends up
      // looking like a bug for a month.
      console.warn(
        `Polar order ${order.id}: no '${consentSlug()}' field on this checkout, so nobody was subscribed. Polar captures NO marketing consent by default — add a Checkbox custom field with that slug in the Polar dashboard and attach it to the template products, or set POLAR_CONSENT_MODE=soft-optin deliberately.`
      );
      record("buyer_no_consent");
      return ok(`order ${order.id}: no consent captured`);
    }

    console.warn(
      `Polar order ${order.id}: no consent field, subscribing under POLAR_CONSENT_MODE=soft-optin. Lawful only for Wael's OWN similar products, and only while every email carries a working unsubscribe link.`
    );
  }

  const outcome = await addBuyer({
    email: order.email,
    name: order.name,
    orderId: order.id,
  });

  record(
    outcome === "added"
      ? "buyer_added"
      : outcome === "already"
        ? "buyer_duplicate"
        : "buyer_failed"
  );

  // 200 even on "failed", by the rule at the top of this file.
  return ok(`order ${order.id}: ${outcome}`);
}
