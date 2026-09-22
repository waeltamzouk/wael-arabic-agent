// The funnel, in one page you can open on your phone.
//
// Guarded by a secret in the URL (`STATS_KEY`), not a login — there is no
// account system here and nothing on this page is personal. It is counts only:
// no names, no phone numbers, no message text. `noindex` keeps it out of
// Google, and a wrong or missing key renders nothing at all.

import type { Metadata } from "next";
import {
  METRICS,
  lastDays,
  readTotals,
  statsEnabled,
  upstashHint,
} from "@/lib/stats";

export const metadata: Metadata = {
  title: "Chat funnel",
  robots: { index: false, follow: false },
};

// Counters change constantly, so never serve this from the cache.
export const dynamic = "force-dynamic";

const DAYS = 14;

const LABELS: Record<string, string> = {
  opened: "Opened the bubble",
  started: "Sent a first message",
  engaged: "Got 3 exchanges in",
  qualified: "Got 6 exchanges in",
  form_shown: "Shown the contact form",
  form_submitted: "Sent the contact form",
  lead_project: "Project leads",
  lead_template: "Template leads",
  lang_ar: "Arabic",
  lang_en: "English",
  blocked_origin: "Blocked: bad origin",
  blocked_rate: "Blocked: rate limit",
  blocked_size: "Blocked: too long",
  buyer_added: "Added to the list",
  buyer_duplicate: "Already on the list",
  buyer_no_consent: "Did not consent",
  buyer_failed: "Resend refused",
  polar_refused: "Blocked: bad signature",
};

const FUNNEL = [
  "opened",
  "started",
  "engaged",
  "qualified",
  // The form's own two steps sit INSIDE the funnel rather than in the Totals
  // grid, because the gap between them is a drop-off like any other — and the
  // most actionable one on the page, since it is the last step before a lead.
  "form_shown",
  "form_submitted",
] as const;

// The Polar webhook's counters. A SEPARATE list from FUNNEL and from the
// Totals grid below, because these describe buyers who never touched the chat.
//
// GOTCHA that hid them for a deploy: the Totals grid hardcodes its six
// metrics. Adding a counter to METRICS and a label to LABELS makes it get
// written and read, and still shows it NOWHERE. A new counter needs a place to
// render or it is invisible.
const BUYERS = [
  "buyer_added",
  "buyer_duplicate",
  "buyer_no_consent",
  "buyer_failed",
  "polar_refused",
] as const;

function pct(part: number, whole: number) {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;
  const expected = process.env.STATS_KEY;

  // No key configured means the page is off, not open to everyone.
  if (!expected || key !== expected) {
    return (
      <main dir="ltr" className="p-8 text-sm text-neutral-500">
        Not found.
      </main>
    );
  }

  if (!statsEnabled()) {
    return (
      <main dir="ltr" className="mx-auto max-w-2xl p-8 text-sm">
        <h1 className="mb-3 text-lg font-semibold">Chat funnel</h1>
        <p className="text-neutral-600">
          Counters are not switched on yet. Add{" "}
          <code className="rounded bg-neutral-100 px-1">
            UPSTASH_REDIS_REST_URL
          </code>{" "}
          and{" "}
          <code className="rounded bg-neutral-100 px-1">
            UPSTASH_REDIS_REST_TOKEN
          </code>{" "}
          in the Vercel project settings, then redeploy. Until then every event
          is still written to the Vercel runtime logs as{" "}
          <code className="rounded bg-neutral-100 px-1">[funnel]</code>.
        </p>
      </main>
    );
  }

  const days = lastDays(DAYS);
  const metrics = [...METRICS];

  // A counter that cannot be read must never take the page down. Before this
  // was caught, a bad Upstash URL or token threw straight out of the component
  // and Next rendered an opaque 500 — which says nothing about what to fix and
  // looks identical to the page being broken. Show the reason instead.
  let byDay: Record<string, Record<string, number>>;
  let overall: Record<string, number>;

  try {
    ({ byDay, overall } = await readTotals(days, metrics));
  } catch (error) {
    console.error("Stats read failed:", error);
    return (
      <main dir="ltr" className="mx-auto w-full min-w-0 max-w-2xl p-6 text-sm sm:p-8">
        <h1 className="text-lg font-semibold">Chat funnel</h1>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
          {upstashHint(error)}
        </p>
        <p className="mt-3 text-neutral-600">
          Nothing is lost while this is broken — every event is still written to
          the Vercel runtime logs as{" "}
          <code className="rounded bg-neutral-100 px-1">[funnel]</code>. Fix the
          variable in the Vercel project settings, then redeploy.
        </p>
      </main>
    );
  }

  const leads = overall.lead_project + overall.lead_template;

  return (
    // `min-w-0 w-full` is load-bearing, and it is the width twin of the scroll
    // bug in CLAUDE.md. `body` is a flex column, so `main` is a flex item, and
    // a flex item defaults to `min-width: auto` — it refuses to shrink below
    // its content. The by-day table is `whitespace-nowrap`, so its min-content
    // width pushed `main` to 573px inside a 436px phone viewport and the whole
    // PAGE scrolled sideways. Under `dir="rtl"` from the root layout that is
    // especially bad: the page opens scrolled to the right and the visitor
    // sees the content cut off. `min-w-0` lets `main` shrink so the table
    // scrolls inside its own wrapper instead.
    <main dir="ltr" className="mx-auto w-full min-w-0 max-w-4xl p-6 text-sm sm:p-8">
      <h1 className="text-lg font-semibold">Chat funnel</h1>
      <p className="mt-1 text-neutral-500">
        All time, plus the last {DAYS} days. Days are Riyadh time. Counts only —
        no names, numbers or message text are stored here.
      </p>

      <section className="mt-6">
        <h2 className="mb-2 font-medium">Where people drop off</h2>
        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <table className="w-full border-collapse">
            <tbody>
              {FUNNEL.map((metric) => (
                <tr key={metric} className="border-b border-neutral-100 last:border-0">
                  <td className="p-3 text-neutral-600">{LABELS[metric]}</td>
                  <td className="p-3 text-right font-medium tabular-nums">
                    {overall[metric] ?? 0}
                  </td>
                  <td className="w-20 p-3 text-right tabular-nums text-neutral-400">
                    {pct(overall[metric] ?? 0, overall.opened ?? 0)}
                  </td>
                </tr>
              ))}
              <tr className="bg-neutral-50">
                <td className="p-3 font-medium">Leads emailed</td>
                <td className="p-3 text-right font-medium tabular-nums">{leads}</td>
                <td className="p-3 text-right tabular-nums text-neutral-400">
                  {pct(leads, overall.opened ?? 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Percentages are of everyone who opened the bubble.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 font-medium">Totals</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {["lead_project", "lead_template", "lang_ar", "lang_en", "blocked_rate", "blocked_size"].map(
            (metric) => (
              <div
                key={metric}
                className="rounded-lg border border-neutral-200 p-3"
              >
                <div className="text-xs text-neutral-500">{LABELS[metric]}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">
                  {overall[metric] ?? 0}
                </div>
              </div>
            )
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 font-medium">Template buyers</h2>
        <p className="mb-2 text-xs text-neutral-500">
          From the Polar webhook, not the chat. Did not consent counts both
          buyers who left the checkout box unticked and orders whose checkout
          never asked — so if it climbs while Added stays at zero, the consent
          field is not attached to the product they bought.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {BUYERS.map((metric) => (
            <div key={metric} className="rounded-lg border border-neutral-200 p-3">
              <div className="text-xs text-neutral-500">{LABELS[metric]}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {overall[metric] ?? 0}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 font-medium">By day</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full border-collapse whitespace-nowrap">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500">
                <th className="p-2 text-left font-medium">Day</th>
                {FUNNEL.map((m) => (
                  <th key={m} className="p-2 text-right font-medium">
                    {LABELS[m].replace("Got ", "").replace(" the bubble", "")}
                  </th>
                ))}
                <th className="p-2 text-right font-medium">Leads</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const row = byDay[day] ?? {};
                const dayLeads =
                  (row.lead_project ?? 0) + (row.lead_template ?? 0);
                return (
                  <tr
                    key={day}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="p-2 text-neutral-600">{day}</td>
                    {FUNNEL.map((m) => (
                      <td key={m} className="p-2 text-right tabular-nums">
                        {row[m] ?? 0}
                      </td>
                    ))}
                    <td className="p-2 text-right font-medium tabular-nums">
                      {dayLeads}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
