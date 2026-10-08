// The audit page's endpoint: a visitor submits a website, a name and an email.
//
// This route does NOT run the audit while the visitor waits. It checks the form,
// checks the limits, creates a job, answers at once with the job's id, and runs
// the audit in `after()` (the same pattern as app/api/whatsapp/route.ts). The
// report page then polls /api/audit/<id>. Two reasons:
//   - the audit takes ~20 s, and the visitor can close the tab without losing it
//   - the lead is saved and the emails go out even if they never come back
//
// THIS ROUTE OPENS WEBSITES CHOSEN BY STRANGERS and SENDS EMAIL to addresses
// chosen by strangers, so everything before the job is created is a gate:
// origin, honeypot, form checks, limits (lib/audit/limits.ts), and the address
// itself (lib/audit/safe-fetch.ts refuses private and internal ones).

import { after, NextRequest, NextResponse } from "next/server";
import { clientIp, isAllowedOrigin } from "@/lib/guard";
import { record } from "@/lib/stats";
import { isTestRequest, runInTestMode } from "@/lib/test-mode";
import { FORM } from "@/lib/audit/copy-ar";
import { assertSafeUrl, domainOf, normalizeUserUrl } from "@/lib/audit/safe-fetch";
import { checkLimits, emailProblem } from "@/lib/audit/limits";
import { processSubmission } from "@/lib/audit/run";
import { cachedJob, newJobId, rememberJob, saveJob, type Job } from "@/lib/audit/store";

export const runtime = "nodejs";
// `after()` runs inside this budget: the crawl has its own 25 s cap, then emails.
export const maxDuration = 60;

const JSON_HEADERS = { "Cache-Control": "no-store" };

/** Fastest a person can plausibly fill three fields, tick a box and press the button. */
const MIN_HUMAN_MS = 2000;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: JSON_HEADERS });
}

function refuse(status: number, error: string, notice: string, metric: string, field?: string) {
  console.warn("Blocked /api/audit request:", error);
  record(metric);
  return reply({ error, notice, ...(field ? { field } : {}) }, status);
}

/** Where report links point. An env var, so the day an audit.waelwebdesign.com exists it is one line. */
function publicBase(req: NextRequest): string {
  const fromEnv = process.env.AUDIT_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  return process.env.NODE_ENV === "production" ? "https://wael-arabic-agent.vercel.app" : req.nextUrl.origin;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function handle(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return refuse(403, `Origin not allowed: ${req.headers.get("origin") ?? "(none)"}.`, "غير مصرح.", "audit_blocked_origin");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return reply({ error: "Invalid JSON body." }, 400);
  }

  // A field no person sees. A bot that fills every field fills it, and it then gets a
  // normal-looking answer while nothing is created, so it learns nothing.
  //
  // BUT A FILLED FIELD IS NOT PROOF OF A BOT. The first version blocked on the field
  // alone, and a browser autofilled it: the site owner was taken for a bot three times
  // and his audit silently thrown away (found from the stats page, not from a log).
  // Losing a real lead costs far more than letting a bot through, and the limits below
  // already cap what a bot can do. So block only when the form was ALSO submitted
  // faster than a person could fill it. `company_site` is the first version's name,
  // still read for pages loaded before the rename.
  const trapped = ["x_hp_8f3a", "company_site"].some((field) => text(body[field], 200));
  if (trapped) {
    const took = typeof body.t === "number" && Number.isFinite(body.t) ? body.t : 0; // no time sent = assume a bot
    if (took < MIN_HUMAN_MS) {
      record("audit_bot");
      return reply({ ok: true, id: newJobId() }, 202);
    }
    console.warn(`[audit] hidden field filled but the form took ${Math.round(took)} ms: treated as a person (browser autofill?).`);
  }

  const name = text(body.name, 80);
  if (name.length < 2) return refuse(400, "Missing name.", FORM.invalidName, "audit_invalid", "name");

  const email = text(body.email, 200).toLowerCase();
  const problem = emailProblem(email);
  if (problem === "shape") return refuse(400, "Bad email.", FORM.invalidEmail, "audit_invalid", "email");
  if (problem === "disposable") return refuse(400, "Disposable email.", FORM.disposable, "audit_invalid", "email");

  if (body.consent !== true) return refuse(400, "No consent.", FORM.consent, "audit_invalid", "consent");

  let url: string;
  let domain: string;
  try {
    url = normalizeUserUrl(text(body.website, 300));
    assertSafeUrl(url);
    domain = domainOf(url);
  } catch (error) {
    return refuse(400, `Bad website: ${(error as Error).message}`, FORM.invalidUrl, "audit_invalid", "website");
  }

  const limit = await checkLimits(clientIp(req), email);
  if (!limit.ok) {
    const notice = limit.reason === "unavailable" ? FORM.unavailable : limit.reason === "global" ? FORM.busy : FORM.tooMany;
    return refuse(limit.reason === "unavailable" ? 503 : 429, `Audit limit: ${limit.reason}.`, notice, `audit_blocked_${limit.reason}`);
  }

  // One audit per site per day: a second visitor asking for the same site gets the
  // same report instead of another crawl of someone's server.
  const existing = await cachedJob(domain);
  const job: Job = existing ?? { id: newJobId(), status: "running", createdAt: Date.now(), domain };
  if (!existing) {
    await saveJob(job);
    await rememberJob(domain, job.id);
    record("audit_started");
  } else {
    record("audit_cached");
  }

  const submission = {
    job,
    reuse: Boolean(existing),
    url,
    name,
    email,
    base: publicBase(req),
    test: isTestRequest(req),
  };
  after(() => processSubmission(submission, { count: record }));

  return reply({ ok: true, id: job.id }, 202);
}

export async function POST(req: NextRequest) {
  return runInTestMode(req, () => handle(req));
}
