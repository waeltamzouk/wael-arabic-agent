// The contact form's endpoint. The visitor types their name and number into
// real fields, and they arrive here — never through Claude. That is the whole
// point of the form: the number reaches the lead email exactly as it was
// typed, with the country it was picked under, so the wa.me link always works.
//
// This route SENDS EMAIL, so it is guarded exactly like /api/chat and shares
// the same rate-limit budget. An unguarded "email Wael" endpoint on a public
// origin is an inbox flood waiting to happen.

import { NextRequest, NextResponse } from "next/server";
import { sendLead, type Lead } from "@/lib/send-lead";
import { whatsappLink } from "@/lib/whatsapp";
import { isKnownCountryCode } from "@/lib/countries";
import { record } from "@/lib/stats";
import {
  clientIp,
  corsHeaders,
  isAllowedOrigin,
  rateLimit,
  type GuardFailure,
} from "@/lib/guard";

// Everything below is typed by a stranger's browser, so everything below is
// capped. These are generous next to what a real answer looks like.
const MAX_NAME = 80;
const MAX_EMAIL = 200;
const MAX_PHONE_DIGITS = 15;
const MIN_PHONE_DIGITS = 6;
// The conversation notes Claude gathered. Long enough for a real sentence,
// short enough that nobody can paste a novel into Wael's inbox.
const MAX_FIELD = 300;

// Shown to the visitor, so both languages, and no English error text ever
// reaches an Arabic speaker.
const NOTICES = {
  ar: {
    name: "اكتب اسمك من فضلك.",
    phone: "تأكد من رقم الجوال.",
    email: "تأكد من الإيميل، أو اتركه فارغاً.",
    failed: "تعذر إرسال بياناتك. حاول مرة أخرى.",
    invalid: "تعذر إرسال بياناتك. حاول مرة أخرى.",
  },
  en: {
    name: "Please enter your name.",
    phone: "Please check your phone number.",
    email: "Please check your email, or leave it empty.",
    failed: "Your details could not be sent. Please try again.",
    invalid: "Your details could not be sent. Please try again.",
  },
} as const;

// Deliberately loose. A strict address regex rejects real addresses, and this
// field is optional anyway — the cost of a typo getting through is nothing,
// the cost of rejecting a valid address is a lost lead.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The notes Claude passed with `request_contact`. Client-supplied by the time
// they come back here, so the keys are an allowlist and the values are cut to
// length — worst case Wael reads an odd note next to a real name and number.
const NOTE_FIELDS = [
  "business",
  "project",
  "budget",
  "timeline",
  "needs",
  "quality",
] as const;

function json(req: NextRequest, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(req) });
}

function refuse(req: NextRequest, failure: GuardFailure, metric: string) {
  console.warn("Blocked /api/lead request:", failure.error);
  record(metric);
  return json(req, { error: failure.error, notice: failure.notice }, failure.status);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function OPTIONS(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return refuse(req, {
      status: 403,
      error: `Origin not allowed: ${req.headers.get("origin") ?? "(none)"}.`,
      notice: "غير مصرح.",
    }, "blocked_origin");
  }

  const limited = rateLimit(clientIp(req));
  if (limited) return refuse(req, limited, "blocked_rate");

  let body: Record<string, unknown>;

  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(req, { error: "Invalid JSON body." }, 400);
  }

  const language = body.language === "en" ? "en" : "ar";
  const notices = NOTICES[language];

  const name = text(body.name, MAX_NAME);
  if (!name) {
    return json(req, { error: "Missing name.", notice: notices.name }, 400);
  }

  // The country comes from the dropdown, so it must be one the dropdown
  // offers. Anything else is not a visitor, it is someone poking the endpoint.
  if (!isKnownCountryCode(body.countryCode)) {
    return json(req, { error: "Unknown country code.", notice: notices.phone }, 400);
  }

  // Leading zeros are the national trunk prefix and never belong after a
  // country code. Stripped here, not left to lib/whatsapp.ts, so the result
  // does not depend on LEAD_DEFAULT_COUNTRY_CODE being set.
  const local = text(body.phone, 40).replace(/\D/g, "").replace(/^0+/, "");
  if (local.length < MIN_PHONE_DIGITS || local.length > MAX_PHONE_DIGITS) {
    return json(req, { error: `Phone has ${local.length} digits.`, notice: notices.phone }, 400);
  }

  const phone = `+${body.countryCode}${local}`;

  // ONE definition of "a usable number" for the whole app: if the wa.me link
  // cannot be built, the number is not good enough to email. The form says so
  // now, while the visitor is still here to fix it — which beats Wael finding
  // out days later that the number is dead.
  const link = whatsappLink(phone);
  if (!link.ok) {
    return json(req, { error: `Unusable phone: ${link.reason}`, notice: notices.phone }, 400);
  }

  const email = text(body.email, MAX_EMAIL);
  if (email && !EMAIL_SHAPE.test(email)) {
    return json(req, { error: "Malformed email.", notice: notices.email }, 400);
  }

  const notes = body.notes as Record<string, unknown> | undefined;
  const lead: Lead = {
    name,
    phone,
    ...(email ? { email } : {}),
    type: notes?.type === "template" ? "template" : "project",
  };

  for (const field of NOTE_FIELDS) {
    const value = text(notes?.[field], MAX_FIELD);
    if (value) lead[field] = value;
  }

  const sent = await sendLead(lead);

  if (!sent) {
    // sendLead already logged the real reason. The visitor is told to retry,
    // and the counter is NOT incremented — a lead Wael never received is not
    // a lead.
    return json(req, { error: "Lead could not be sent.", notice: notices.failed }, 502);
  }

  record(
    "form_submitted",
    lead.type === "template" ? "lead_template" : "lead_project"
  );

  return json(req, { ok: true });
}
