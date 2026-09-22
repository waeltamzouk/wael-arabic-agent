// Everything about a Polar webhook that is NOT "add the buyer to the list":
// proving the request really came from Polar, and reading the one thing the
// order tells us about permission to email them.
//
// NO new dependency, same reasoning as `lib/stats.ts`: Polar's own SDK exists
// only to do the HMAC below and parse JSON, and `node:crypto` already does the
// HMAC. The project stays on three runtime deps.

import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// 1. Signature
// ---------------------------------------------------------------------------
//
// Polar follows the Standard Webhooks spec. Three headers travel with every
// delivery, and the signed string is the three of them joined by dots:
//
//   webhook-id         an opaque delivery id
//   webhook-timestamp  unix SECONDS (not milliseconds)
//   webhook-signature  space-separated list of "v1,<base64 HMAC-SHA256>"
//
//   signed = `${id}.${timestamp}.${raw body}`
//
// THE BODY MUST BE THE RAW BYTES AS SENT. `await req.json()` re-serialises and
// changes whitespace and key order, and the HMAC then never matches. Read
// `await req.text()` and parse afterwards — that is why this file takes a
// string and the route reads the body only once.
//
// GOTCHA, and it is the thing that breaks most Polar integrations: Polar has
// TWO key derivations, split by when the secret was generated.
//
//   - Secrets from BEFORE 8 Sep 2026 use "Polar HMAC": you base64-ENCODE the
//     whole `whsec_…` string before handing it to a Standard Webhooks library,
//     which base64-DECODES it again — so the real key is the raw UTF-8 bytes
//     of the secret string.
//   - Secrets from ON OR AFTER 8 Sep 2026 are plain Standard Webhooks: the key
//     is the base64-DECODED secret, minus its `whsec_` prefix.
//
// The symptom of picking the wrong one is a 403 on every single delivery, with
// nothing to distinguish it from a wrong secret. Polar's own SDK gave up and
// tries both keys; so does this. Trying both costs one extra HMAC of a few
// kilobytes and removes a whole class of "it just doesn't work" — the secret
// still has to be right, because a wrong secret matches under neither scheme.

// Standard Webhooks' own recommendation. Stops a captured delivery being
// replayed at us days later.
const TOLERANCE_SECONDS = 5 * 60;

export type Verdict = { ok: true } | { ok: false; reason: string };

function keysFor(secret: string): Buffer[] {
  const keys: Buffer[] = [];

  // Standard Webhooks (current secrets).
  const withoutPrefix = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const decoded = Buffer.from(withoutPrefix, "base64");
  if (decoded.length > 0) keys.push(decoded);

  // Polar HMAC (older secrets).
  keys.push(Buffer.from(secret, "utf8"));

  return keys;
}

// Length is compared first and in the clear on purpose: `timingSafeEqual`
// THROWS on a length mismatch rather than returning false, and the length of a
// base64 SHA-256 digest is public knowledge anyway.
function sameSignature(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * True only when `raw` was signed by whoever holds `secret`.
 *
 * `headers` is the request's own Headers object — header names are matched
 * case-insensitively by it, which matters because proxies rewrite their case.
 */
export function verifyPolarSignature(
  raw: string,
  headers: Headers,
  secret: string
): Verdict {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signature = headers.get("webhook-signature");

  if (!id || !timestamp || !signature) {
    return {
      ok: false,
      reason: "Missing webhook-id, webhook-timestamp or webhook-signature.",
    };
  }

  const sentAt = Number(timestamp);

  if (!Number.isFinite(sentAt)) {
    return { ok: false, reason: `webhook-timestamp is not a number: ${timestamp}.` };
  }

  // Both directions: a timestamp in the future is as suspicious as an old one,
  // and a clock that has drifted forward is worth seeing in the logs.
  const driftSeconds = Math.abs(Date.now() / 1000 - sentAt);

  if (driftSeconds > TOLERANCE_SECONDS) {
    return {
      ok: false,
      reason: `webhook-timestamp is ${Math.round(driftSeconds)}s away from now (max ${TOLERANCE_SECONDS}s). Replay, or a badly wrong server clock.`,
    };
  }

  const signed = `${id}.${timestamp}.${raw}`;

  const expected = keysFor(secret).map((key) =>
    createHmac("sha256", key).update(signed).digest("base64")
  );

  // The header can carry SEVERAL signatures — that is how Standard Webhooks
  // rotates a secret without dropping deliveries. Any one of them matching is
  // a pass. Each entry is "v1,<base64>"; a bare value with no version prefix
  // is treated as v1 rather than silently ignored.
  const offered = signature
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      const comma = part.indexOf(",");
      return comma === -1 ? part : part.slice(comma + 1);
    });

  for (const candidate of offered) {
    for (const mine of expected) {
      if (sameSignature(candidate, mine)) return { ok: true };
    }
  }

  return {
    ok: false,
    reason:
      "No signature matched, under either of Polar's two key schemes. POLAR_WEBHOOK_SECRET is almost certainly wrong — copy it again from the endpoint in the Polar dashboard.",
  };
}

// ---------------------------------------------------------------------------
// 2. The order
// ---------------------------------------------------------------------------
//
// Field names verified against Polar's published OpenAPI schema (2026-04), not
// from memory: `Order` has `id`, `status`, `paid`, `custom_field_data` and a
// nested `customer` (`OrderCustomer`) carrying `email` and `name`. The webhook
// envelope is `{ type, timestamp, api_version, data }`.

export type PolarOrder = {
  id: string;
  status?: string;
  paid?: boolean;
  email?: string;
  name?: string;
  product?: string;
  customFields: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The event name, e.g. `order.paid`. */
export function eventType(payload: unknown): string | undefined {
  return asString(asRecord(payload).type);
}

export function readOrder(payload: unknown): PolarOrder | null {
  const data = asRecord(asRecord(payload).data);
  const id = asString(data.id);

  if (!id) return null;

  const customer = asRecord(data.customer);

  return {
    id,
    status: asString(data.status),
    paid: typeof data.paid === "boolean" ? data.paid : undefined,
    // `customer.email` is where the buyer's address lives. `billing_name` is a
    // reasonable fallback for the name when the customer record has none — a
    // guest checkout fills the billing name and nothing else.
    email: asString(customer.email),
    name: asString(customer.name) ?? asString(data.billing_name),
    product: asString(asRecord(data.product).name),
    customFields: asRecord(data.custom_field_data),
  };
}

/**
 * Was this order actually paid for?
 *
 * `order.created` fires when the INVOICE is generated, which for card payments
 * is before the money moves — `status` is `pending` at that moment and becomes
 * `paid` later, when `order.paid` fires. Adding someone at `order.created`
 * therefore mails people whose payment failed. The route listens for both
 * events and lets this decide, so whichever one arrives paid is the one that
 * subscribes them, and the other is a no-op.
 */
export function isPaid(order: PolarOrder): boolean {
  return order.paid === true || order.status === "paid";
}

// ---------------------------------------------------------------------------
// 3. Consent
// ---------------------------------------------------------------------------
//
// THE FINDING, and it decides the shape of this whole feature: POLAR'S
// CHECKOUT CAPTURES NO MARKETING CONSENT AT ALL. Searching Polar's OpenAPI
// schema (2026-04) for "marketing", "newsletter", "opt_in" and "mailing"
// returns nothing — the only "consent" in the entire API is an OAuth screen.
// Polar collects what it needs to take the money and deliver the product, and
// that is all it collects.
//
// So there is no consent to read unless Wael ADDS a checkbox to the checkout:
// Polar dashboard → Custom Fields → new field, type Checkbox, slug
// `marketing_consent`, then attach it to each template product. NOT required —
// a required "consent" box is not consent, it is a toll gate. Whatever the
// buyer ticks arrives as `custom_field_data.marketing_consent`, a real boolean.
//
// Until that checkbox exists this endpoint verifies, logs and adds NOBODY, and
// says why in the log. A feature that does nothing is the correct behaviour
// here: the alternative is mailing people who never agreed to be mailed.

const CONSENT_SLUG = (process.env.POLAR_CONSENT_FIELD || "marketing_consent").trim();

export type Consent = "yes" | "no" | "not-asked";

export function consentSlug(): string {
  return CONSENT_SLUG;
}

export function consentFrom(order: PolarOrder): Consent {
  const value = order.customFields[CONSENT_SLUG];

  // The field is not on the checkout at all. Different from "they said no",
  // and worth a different log line — one is a missing setup step, the other is
  // a buyer's answer.
  if (value === undefined || value === null) return "not-asked";

  if (typeof value === "boolean") return value ? "yes" : "no";

  // A Select or Text field instead of a Checkbox still works, as long as the
  // value reads as a yes. Cheap to allow and stops a mis-typed field silently
  // meaning "no" forever.
  const text = String(value).trim().toLowerCase();
  return ["true", "yes", "1", "on", "نعم"].includes(text) ? "yes" : "no";
}

/**
 * What to do when the checkout never asked.
 *
 * `checkbox` (the default): no checkbox, no subscriber. Refuses to guess.
 *
 * `soft-optin`: treat the purchase itself as the lawful basis. This is a real
 * thing and not a loophole — GDPR/PECR's soft opt-in covers marketing your own
 * similar products to an existing customer, PROVIDED they were offered an
 * opt-out when you took their address and in every message since. Wael has to
 * turn it on deliberately, per deployment, and it is logged loudly every time
 * it fires, because "the env var was already set" is not a decision anyone
 * remembers making.
 */
export function consentMode(): "checkbox" | "soft-optin" {
  return process.env.POLAR_CONSENT_MODE?.trim() === "soft-optin"
    ? "soft-optin"
    : "checkbox";
}
