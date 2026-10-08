// Where the report page asks "is my audit done yet?". Read-only.
//
// The id is 128 random bits (lib/audit/store.ts), so this can be called without
// a login and still not be enumerated: there is nothing to guess. The answer
// carries no personal data. It is marked no-store and noindex, so neither a
// cache nor a search engine keeps someone's report.

import { NextRequest, NextResponse } from "next/server";
import { FORM } from "@/lib/audit/copy-ar";
import { isJobId, loadJob } from "@/lib/audit/store";

export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  if (!isJobId(id)) {
    return NextResponse.json({ error: "Not found.", notice: FORM.notFound }, { status: 404, headers: HEADERS });
  }

  let job;
  try {
    job = await loadJob(id);
  } catch (error) {
    console.error("Reading an audit job failed:", error);
    return NextResponse.json({ error: "Storage error.", notice: FORM.unavailable }, { status: 503, headers: HEADERS });
  }
  if (!job) {
    return NextResponse.json({ error: "Not found.", notice: FORM.notFound }, { status: 404, headers: HEADERS });
  }

  return NextResponse.json(
    { status: job.status, domain: job.domain, report: job.report ?? null, failure: job.failure ?? null },
    { headers: HEADERS }
  );
}
