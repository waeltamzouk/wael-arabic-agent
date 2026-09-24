// The funnel, in one page you can open on your phone.
//
// Guarded by a secret in the URL (`STATS_KEY`), not a login — there is no
// account system here and nothing on this page is personal. It is counts only:
// no names, no phone numbers, no message text. `noindex` keeps it out of
// Google, and a wrong or missing key renders nothing at all.

import type { Metadata } from "next";
import { siteMetric } from "@/lib/site";
import {
  allMetrics,
  lastDays,
  readTotals,
  statsEnabled,
  upstashHint,
  whatsappMetric,
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
  discount_offered: "Offered the 30% code",
  discount_unlocked: "Gave an email, got the code",
  discount_bad_email: "Code: email refused",
  discount_list_failed: "Code given, not on the list",
  discount_no_code: "Code missing (env var)",
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
  not_text: "Voice notes, photos (not read)",
  send_failed: "Reply not delivered (Meta)",
  lead_failed: "Lead not emailed (Resend)",
  refused: "Blocked: bad signature",
};

// The same counter can mean a different moment on WhatsApp, where there is no
// form: request_contact asks for the name in words instead.
const WHATSAPP_LABELS: Record<string, string> = {
  form_shown: "Asked for their name",
  form_submitted: "Lead sent",
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

// One section per site, because the two sites are separate businesses with
// separate funnels (see "The two sites are SEPARATE" in CLAUDE.md). Adding them
// together would say nothing about either. The Arabic site reads the bare
// counter names, so its numbers are exactly what this page showed before
// W7-T3; the English site reads `templates_*`.
//
// The English site has no contact form. Its last two funnel steps are the
// email-for-code pair instead, and it has no leads row: an email for a code is
// a subscriber, not a lead for Wael.
//
// WhatsApp (W8-T2) is a CHANNEL, not a site — it answers for the Arabic site —
// but it gets its own section for the same reason: to be read side by side.
// Its funnel uses the same counter names, so rows line up with the Arabic
// site's. It has no "opened" step (the first message is the opening), so its
// percentages are of `started` — compare it to the Arabic site's rows from
// "Sent a first message" down, not to its percentages.
const SITE_VIEWS: {
  id: string;
  // The stored key for a bare counter name in this section.
  key: (metric: string) => string;
  // What the percentages are "of".
  base: string;
  labels?: Record<string, string>;
  title: string;
  subtitle: string;
  funnel: readonly string[];
  totals: readonly string[];
  leads: boolean;
}[] = [
  {
    id: "waelwebdesign",
    key: (metric) => siteMetric("waelwebdesign", metric),
    base: "opened",
    title: "waelwebdesign.com",
    subtitle: "Arabic agent — services and templates",
    funnel: FUNNEL,
    totals: ["lead_project", "lead_template", "lang_ar", "lang_en", "blocked_rate", "blocked_size"],
    leads: true,
  },
  {
    id: "templates",
    key: (metric) => siteMetric("templates", metric),
    base: "opened",
    title: "waeltamzouk.framer.ai",
    subtitle: "English templates agent",
    funnel: ["opened", "started", "engaged", "qualified", "discount_offered", "discount_unlocked"],
    totals: ["discount_bad_email", "discount_list_failed", "discount_no_code", "blocked_rate", "blocked_size"],
    leads: false,
  },
  {
    id: "whatsapp",
    key: (metric) => whatsappMetric(metric as Parameters<typeof whatsappMetric>[0]),
    base: "started",
    labels: WHATSAPP_LABELS,
    title: "WhatsApp",
    subtitle: "The Arabic agent on Wael's WhatsApp number. Percentages are of first messages.",
    funnel: ["started", "engaged", "qualified", "form_shown", "form_submitted"],
    totals: ["lead_project", "lead_template", "lang_ar", "lang_en", "not_text", "blocked_rate", "send_failed", "lead_failed", "refused"],
    leads: true,
  },
];

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
  const metrics = allMetrics();

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

  // A section's own count for a bare metric name.
  const count = (
    totals: Record<string, number>,
    view: (typeof SITE_VIEWS)[number],
    metric: string
  ) => totals[view.key(metric)] ?? 0;

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

      {SITE_VIEWS.map((view) => {
        const { id, title, subtitle, funnel, totals, leads } = view;
        const label = (metric: string) => view.labels?.[metric] ?? LABELS[metric];
        const opened = count(overall, view, view.base);
        const leadCount = leads
          ? count(overall, view, "lead_project") + count(overall, view, "lead_template")
          : 0;

        return (
          <section key={id} className="mt-10 border-t border-neutral-200 pt-6">
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-0.5 text-neutral-500">{subtitle}</p>

            <h3 className="mb-2 mt-4 font-medium">Where people drop off</h3>
            <div className="overflow-hidden rounded-lg border border-neutral-200">
              <table className="w-full border-collapse">
                <tbody>
                  {funnel.map((metric) => (
                    <tr key={metric} className="border-b border-neutral-100 last:border-0">
                      <td className="p-3 text-neutral-600">{label(metric)}</td>
                      <td className="p-3 text-right font-medium tabular-nums">
                        {count(overall, view, metric)}
                      </td>
                      <td className="w-20 p-3 text-right tabular-nums text-neutral-400">
                        {pct(count(overall, view, metric), opened)}
                      </td>
                    </tr>
                  ))}
                  {leads && (
                    <tr className="bg-neutral-50">
                      <td className="p-3 font-medium">Leads emailed</td>
                      <td className="p-3 text-right font-medium tabular-nums">{leadCount}</td>
                      <td className="p-3 text-right tabular-nums text-neutral-400">
                        {pct(leadCount, opened)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              {view.base === "opened"
                ? "Percentages are of everyone who opened the bubble on this site."
                : "Percentages are of everyone who sent a first message."}
            </p>

            <h3 className="mb-2 mt-6 font-medium">Totals</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {totals.map((metric) => (
                <div key={metric} className="rounded-lg border border-neutral-200 p-3">
                  <div className="text-xs text-neutral-500">{label(metric)}</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">
                    {count(overall, view, metric)}
                  </div>
                </div>
              ))}
            </div>

            <h3 className="mb-2 mt-6 font-medium">By day</h3>
            <div className="overflow-x-auto rounded-lg border border-neutral-200">
              <table className="w-full border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500">
                    <th className="p-2 text-left font-medium">Day</th>
                    {funnel.map((m) => (
                      <th key={m} className="p-2 text-right font-medium">
                        {label(m).replace("Got ", "").replace(" the bubble", "")}
                      </th>
                    ))}
                    {leads && <th className="p-2 text-right font-medium">Leads</th>}
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => {
                    const row = byDay[day] ?? {};
                    return (
                      <tr key={day} className="border-b border-neutral-100 last:border-0">
                        <td className="p-2 text-neutral-600">{day}</td>
                        {funnel.map((m) => (
                          <td key={m} className="p-2 text-right tabular-nums">
                            {count(row, view, m)}
                          </td>
                        ))}
                        {leads && (
                          <td className="p-2 text-right font-medium tabular-nums">
                            {count(row, view, "lead_project") + count(row, view, "lead_template")}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <section className="mt-10 border-t border-neutral-200 pt-6">
        <h2 className="text-base font-semibold">Template buyers</h2>
        <p className="mb-2 mt-0.5 text-xs text-neutral-500">
          From the Polar webhook, not the chat, so it belongs to neither site
          above. Did not consent counts both buyers who left the checkout box
          unticked and orders whose checkout never asked — so if it climbs while
          Added stays at zero, the consent field is not attached to the product
          they bought.
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
    </main>
  );
}
