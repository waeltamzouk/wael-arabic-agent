// A single counter ping, for the one funnel step the chat route cannot see:
// someone opened the bubble and never typed anything.
//
// Deliberately tiny. It takes no body, calls no API, stores nothing about the
// visitor, and answers 204. The event name is a QUERY PARAM against a fixed
// allowlist, not a JSON body, so the browser treats the request as "simple" and
// never sends a CORS preflight — which is what lets the Framer snippet fire it
// with `navigator.sendBeacon` even as the page is being navigated away from.

import { NextRequest, NextResponse } from "next/server";
import { clientIp, corsHeaders, isAllowedOrigin, rateLimit } from "@/lib/guard";
import { siteFromParam, siteMetric } from "@/lib/site";
import { record } from "@/lib/stats";

// Nothing else is countable from the browser. An allowlist means a stranger
// cannot invent metric names and pollute the counters.
const ALLOWED_EVENTS = new Set(["opened"]);

export async function OPTIONS(req: NextRequest) {
  if (!isAllowedOrigin(req)) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return new NextResponse(null, { status: 403, headers: corsHeaders(req) });
  }

  // Shares the chat route's limiter and its budget on purpose: this endpoint
  // must never become the cheap way to burn someone's quota, and a visitor who
  // is already rate limited has nothing worth counting.
  if (rateLimit(clientIp(req))) {
    return new NextResponse(null, { status: 429, headers: corsHeaders(req) });
  }

  const name = req.nextUrl.searchParams.get("name") ?? "";
  // Same `?site=` as /api/chat. No param (or an unknown one) is the Arabic
  // site, which is what the live waelwebdesign.com snippet sends.
  const site = siteFromParam(req.nextUrl.searchParams.get("site"));

  if (!ALLOWED_EVENTS.has(name)) {
    return new NextResponse(null, { status: 400, headers: corsHeaders(req) });
  }

  record(siteMetric(site, name));

  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
