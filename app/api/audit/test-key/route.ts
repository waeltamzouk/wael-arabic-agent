// "Is the test key in this tab the real one?" Answers { valid: true | false }.
//
// Why it exists: /audit?test=<key> shows a banner saying the audit will not be counted.
// The page cannot know whether the key is the real STATS_KEY, only the server can. Without
// this check the banner appeared for ANY value, including a pasted placeholder like
// "<your STATS_KEY>", and promised "not counted" while the audit WAS counted. The page now
// asks, and tells the truth either way.
//
// It only ever answers yes or no and never reveals the key. The comparison is the same
// timing-safe one the test switch itself uses (lib/test-mode.ts), and the route shares the
// chat's per-IP rate limit, so it is not a way to guess the key quickly.

import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/guard";
import { isTestRequest } from "@/lib/test-mode";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (rateLimit(clientIp(req))) {
    return NextResponse.json({ valid: false }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ valid: isTestRequest(req) }, { headers: { "Cache-Control": "no-store" } });
}
