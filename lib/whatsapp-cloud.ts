// Everything about talking to Meta's WhatsApp Cloud API, and nothing about the
// agent: proving a webhook call came from Meta, reading the messages out of it,
// and sending a reply back. The agent lives in lib/whatsapp-agent.ts, the
// memory in lib/whatsapp-memory.ts.
//
// NO new dependency, same reasoning as lib/polar-webhook.ts: Meta's SDKs only
// wrap one HMAC and one POST, and `node:crypto` and `fetch` already do both.
//
// Env vars, all four in `.env.local` AND in Vercel:
//   WHATSAPP_APP_SECRET       App settings → Basic → App Secret. Signs webhooks.
//   WHATSAPP_VERIFY_TOKEN     Any string Wael makes up. Typed into BOTH the
//                             Vercel settings and Meta's webhook page; Meta
//                             sends it back once, when the webhook is saved.
//   WHATSAPP_TOKEN            A SYSTEM USER token, expiry "Never". The token on
//                             the API Setup page dies after 24 hours, and the
//                             symptom is every reply failing with code 190.
//   WHATSAPP_PHONE_NUMBER_ID  The number's ID from API Setup — NOT the phone
//                             number. Swapping the test number for the real
//                             one is changing this value, nothing else.

import { createHmac, timingSafeEqual } from "node:crypto";

// Pinned, because Meta changes payload shapes between versions. v26.0 was the
// newest on Sep 24 2026 and each version lives about two years.
const GRAPH_VERSION = "v26.0";

// Overridable ONLY so a test can point it at a local stand-in, the same trick
// as ANTHROPIC_BASE_URL and the Upstash stand-in in CLAUDE.md. Never set it in
// Vercel.
const GRAPH_URL = (
  process.env.WHATSAPP_GRAPH_URL?.trim() || "https://graph.facebook.com"
).replace(/\/+$/, "");

// A single WhatsApp text can be 4,096 characters. A maxed-out Arabic reply is
// ~1,550 (see "The caps, actually measured"), so this never fires in practice —
// it just means a runaway reply is cut instead of refused by Meta.
const MAX_TEXT = 4096;

// ---------------------------------------------------------------------------
// 1. Signature
// ---------------------------------------------------------------------------
//
// Every webhook POST carries `X-Hub-Signature-256: sha256=<hex>`, the HMAC-SHA256
// of the RAW body keyed with the App Secret.
//
// GOTCHA, the same one as Polar: the body must be the exact bytes Meta sent.
// Meta escapes non-ASCII as \uXXXX, so an Arabic message re-serialised by
// `JSON.stringify` is a DIFFERENT string and the HMAC never matches. The route
// reads `req.text()` once, verifies, and only then parses.
//
// This is the ONLY lock on the route. There is no origin allowlist, because
// Meta's servers send no Origin header — lib/guard.ts would refuse every
// message. Different caller, different lock.

export type Verdict = { ok: true } | { ok: false; reason: string };

export function verifyMetaSignature(
  raw: string,
  header: string | null,
  appSecret: string
): Verdict {
  if (!header) return { ok: false, reason: "no X-Hub-Signature-256 header" };

  const [scheme, hex] = header.split("=", 2);
  if (scheme !== "sha256" || !hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    return { ok: false, reason: "malformed X-Hub-Signature-256 header" };
  }

  const expected = createHmac("sha256", appSecret).update(raw, "utf8").digest();
  const given = Buffer.from(hex, "hex");

  // Same length is guaranteed by the regex above; timingSafeEqual throws
  // otherwise, and a throw here would be a 500 instead of a 403.
  return timingSafeEqual(expected, given)
    ? { ok: true }
    : { ok: false, reason: "signature does not match — wrong WHATSAPP_APP_SECRET, or not Meta" };
}

// ---------------------------------------------------------------------------
// 2. Reading the webhook
// ---------------------------------------------------------------------------

export type Inbound = {
  // Meta's message id. Used to drop duplicates (Meta retries deliveries) and
  // to show the "typing…" indicator on the right message.
  id: string;
  // The sender's number: digits only, country code first, no + — e.g.
  // "905377634437". This is the phone number the contact form exists to get.
  from: string;
  // The name on their WhatsApp profile. Theirs to set, so it can be a
  // nickname, an emoji or a business name — a hint, never a fact.
  profileName: string;
  // "text" is the only type the agent reads. Everything else (voice notes,
  // photos, stickers, locations) gets a polite "text only" reply.
  type: string;
  text: string;
  // Unix seconds.
  timestamp: number;
};

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return typeof value === "object" && value !== null ? (value as Obj) : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Every customer message in a webhook payload.
 *
 * A payload can carry several `entry`/`changes`, and most of them are NOT
 * messages: `statuses` (sent / delivered / read receipts for OUR replies)
 * arrive on the same webhook far more often than messages do. Those produce
 * nothing here — answering a read receipt would be a loop.
 *
 * `phoneNumberId`, when set, drops messages sent to any other number on the
 * same Meta app — so a second number added later for a client can never be
 * answered by Wael's agent by accident.
 */
export function readInbound(payload: unknown, phoneNumberId?: string): Inbound[] {
  const found: Inbound[] = [];

  for (const entry of list(obj(payload).entry)) {
    for (const change of list(obj(entry).changes)) {
      if (obj(change).field !== "messages") continue;
      const value = obj(obj(change).value);

      const to = str(obj(value.metadata).phone_number_id);
      if (phoneNumberId && to && to !== phoneNumberId) continue;

      const names = new Map<string, string>();
      for (const contact of list(value.contacts)) {
        names.set(str(obj(contact).wa_id), str(obj(obj(contact).profile).name));
      }

      for (const message of list(value.messages)) {
        const m = obj(message);
        const from = str(m.from).replace(/\D/g, "");
        const id = str(m.id);
        if (!from || !id) continue;

        found.push({
          id,
          from,
          profileName: names.get(str(m.from)) ?? "",
          type: str(m.type),
          text: m.type === "text" ? str(obj(m.text).body) : "",
          timestamp: Number(m.timestamp) || 0,
        });
      }
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// 3. Sending
// ---------------------------------------------------------------------------

// Meta's error codes that have one obvious cause, in words Wael can act on.
// The rest are logged as they come.
const HINTS: Record<number, string> = {
  190: "the access token is wrong or expired. Use a SYSTEM USER token with expiry 'Never', not the 24-hour one from the API Setup page.",
  131030: "this number is not on the test number's allowed list. Add it under WhatsApp → API Setup → 'To'.",
  131047: "more than 24 hours since this person last wrote. Only an approved template can reach them now.",
  131026: "the message could not be delivered — the person may not have WhatsApp, or has an old version.",
  100: "a parameter is wrong — usually WHATSAPP_PHONE_NUMBER_ID is the phone number instead of its ID.",
};

function sendConfig() {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  return token && phoneNumberId ? { token, phoneNumberId } : null;
}

async function post(body: Obj, what: string): Promise<boolean> {
  const config = sendConfig();

  if (!config) {
    console.error(
      `[whatsapp] ${what} not sent: WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID is missing.`
    );
    return false;
  }

  try {
    const res = await fetch(
      `${GRAPH_URL}/${GRAPH_VERSION}/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
        cache: "no-store",
      }
    );

    if (res.ok) return true;

    // Meta's error body names the problem and never echoes the token, so it is
    // safe to log whole — and it is the only place the real reason exists.
    const text = await res.text();
    let code = 0;
    try {
      code = Number(obj(obj(JSON.parse(text)).error).code) || 0;
    } catch {}
    console.error(
      `[whatsapp] ${what} failed, Meta answered ${res.status}${
        HINTS[code] ? ` — ${HINTS[code]}` : ""
      }`,
      text
    );
    return false;
  } catch (error) {
    console.error(`[whatsapp] ${what} failed, could not reach Meta:`, error);
    return false;
  }
}

/** Send a plain text reply. Only works inside the 24-hour window. */
export function sendText(to: string, text: string): Promise<boolean> {
  return post(
    {
      recipient_type: "individual",
      to,
      type: "text",
      // preview_url: a template or a Polar link shows its card, which is most
      // of what makes a link worth tapping.
      text: { body: text.slice(0, MAX_TEXT), preview_url: true },
    },
    "reply"
  );
}

/**
 * Blue ticks plus "typing…" on their screen while Claude thinks. An Arabic
 * reply takes 5-15 seconds, and without this the chat just looks dead for that
 * long. Meta clears the indicator when the reply lands, or after 25 seconds.
 * Purely cosmetic: a failure is logged and ignored.
 */
export function showTyping(messageId: string): Promise<boolean> {
  return post(
    {
      status: "read",
      message_id: messageId,
      typing_indicator: { type: "text" },
    },
    "typing indicator"
  );
}
