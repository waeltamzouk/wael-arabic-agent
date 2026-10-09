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
  starter_tap: "First message was a tapped starter",
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
  audit_started: "Audits started",
  audit_cached: "Reused a recent audit (same site)",
  audit_done: "Audits finished",
  audit_failed: "Site could not be audited",
  audit_invalid: "Form refused (bad input)",
  audit_bot: "Caught by the hidden field (bot)",
  audit_blocked_origin: "Blocked: bad origin",
  audit_blocked_ip: "Blocked: too many from one IP",
  audit_blocked_email: "Blocked: too many for one email",
  audit_blocked_global: "Blocked: daily cap reached",
  audit_blocked_unavailable: "Refused: storage unavailable",
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

// The website audit page. Same lesson as BUYERS: a counter nobody renders is invisible.
const AUDITS = [
  "audit_started",
  "audit_cached",
  "audit_done",
  "audit_failed",
  "audit_invalid",
  "audit_bot",
  "audit_blocked_ip",
  "audit_blocked_email",
  "audit_blocked_global",
  "audit_blocked_origin",
  "audit_blocked_unavailable",
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
    totals: ["starter_tap", "lead_project", "lead_template", "lang_ar", "lang_en", "blocked_rate", "blocked_size"],
    leads: true,
  },
  {
    id: "templates",
    key: (metric) => siteMetric("templates", metric),
    base: "opened",
    title: "waeltamzouk.framer.ai",
    subtitle: "English templates agent",
    funnel: ["opened", "started", "engaged", "qualified", "discount_offered", "discount_unlocked"],
    totals: ["starter_tap", "discount_bad_email", "discount_list_failed", "discount_no_code", "blocked_rate", "blocked_size"],
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

// ---- Look (the "wael-style" skill): graphite, one accent, no white ----------
// Always dark, whatever the system theme says, like the client dashboard.

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-[#0d0d0f] text-[#ededed] [color-scheme:dark]">
      {children}
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-3xl border border-[#26262b] bg-gradient-to-b from-[#18181c] to-[#131316] p-5 sm:p-6 ${className}`}
    >
      {children}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#26262b] bg-[#16161a] p-4">
      <div className="text-sm leading-snug text-[#9a9aa3]">{label}</div>
      <div className="mt-2 text-3xl font-semibold leading-none tabular-nums">{value}</div>
    </div>
  );
}

function Block({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-6 scroll-mt-6">
      <Card>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1.5 max-w-3xl text-base leading-relaxed text-[#8f8f98]">{note}</p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
      </Card>
    </section>
  );
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
      <Page>
        <main dir="ltr" className="p-8 text-base text-[#8f8f98]">
          Not found.
        </main>
      </Page>
    );
  }

  if (!statsEnabled()) {
    return (
      <Page>
        <main dir="ltr" className="mx-auto max-w-2xl p-8">
          <Card>
            <h1 className="mb-3 text-xl font-semibold">Chat funnel</h1>
            <p className="text-base leading-relaxed text-[#9a9aa3]">
              Counters are not switched on yet. Add{" "}
              <code className="rounded bg-[#0d0d0f] px-1.5 py-0.5">UPSTASH_REDIS_REST_URL</code>{" "}
              and{" "}
              <code className="rounded bg-[#0d0d0f] px-1.5 py-0.5">UPSTASH_REDIS_REST_TOKEN</code>{" "}
              in the Vercel project settings, then redeploy. Until then every event
              is still written to the Vercel runtime logs as{" "}
              <code className="rounded bg-[#0d0d0f] px-1.5 py-0.5">[funnel]</code>.
            </p>
          </Card>
        </main>
      </Page>
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
      <Page>
        <main dir="ltr" className="mx-auto w-full min-w-0 max-w-2xl p-6 sm:p-8">
          <Card>
            <h1 className="text-xl font-semibold">Chat funnel</h1>
            <p className="mt-4 rounded-2xl border border-[#4a3b12] bg-[#2b2310] p-4 text-base leading-relaxed text-[#fbbf24]">
              {upstashHint(error)}
            </p>
            <p className="mt-4 text-base leading-relaxed text-[#9a9aa3]">
              Nothing is lost while this is broken — every event is still written
              to the Vercel runtime logs as{" "}
              <code className="rounded bg-[#0d0d0f] px-1.5 py-0.5">[funnel]</code>. Fix
              the variable in the Vercel project settings, then redeploy.
            </p>
          </Card>
        </main>
      </Page>
    );
  }

  // A section's own count for a bare metric name.
  const count = (
    totals: Record<string, number>,
    view: (typeof SITE_VIEWS)[number],
    metric: string
  ) => totals[view.key(metric)] ?? 0;

  return (
    <Page>
      {/* `min-w-0 w-full` is load-bearing, and it is the width twin of the scroll
          bug in CLAUDE.md. `body` is a flex column, so `main` is a flex item, and
          a flex item defaults to `min-width: auto` — it refuses to shrink below
          its content. The by-day table is `whitespace-nowrap`, so its min-content
          width pushed `main` to 573px inside a 436px phone viewport and the whole
          PAGE scrolled sideways. `min-w-0` lets `main` shrink so the table scrolls
          inside its own wrapper instead. */}
      <main dir="ltr" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 sm:px-6">
        <header className="flex items-start gap-4">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] shadow-[0_0_24px_-6px_var(--accent)]"
            aria-hidden="true"
          >
            <span className="size-3.5 rounded-full bg-white" />
          </span>
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold leading-tight">Chat funnel</h1>
            <p className="mt-1.5 max-w-3xl text-base leading-relaxed text-[#8f8f98]">
              All time, plus the last {DAYS} days. Days are Riyadh time. Counts only —
              no names, numbers or message text are stored here.
            </p>
          </div>
        </header>

        <nav aria-label="Sections" className="mt-6 flex flex-wrap gap-2">
          {[
            ...SITE_VIEWS.map((v) => ({ id: v.id, title: v.title })),
            { id: "buyers", title: "Template buyers" },
            { id: "audits", title: "Website audits" },
          ].map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`rounded-full border border-[#26262b] bg-[#151518] px-4 py-2 text-sm text-[#c9c9d0] transition-colors hover:border-[var(--accent)] hover:text-white ${FOCUS}`}
            >
              {item.title}
            </a>
          ))}
        </nav>

        {SITE_VIEWS.map((view) => {
          const { id, title, subtitle, funnel, totals, leads } = view;
          const label = (metric: string) => view.labels?.[metric] ?? LABELS[metric];
          const base = count(overall, view, view.base);
          const leadCount = leads
            ? count(overall, view, "lead_project") + count(overall, view, "lead_template")
            : 0;
          const firstMessages = count(overall, view, "started");
          const biggest = Math.max(1, ...funnel.map((m) => count(overall, view, m)));

          // The darkest and the brightest cell of each by-day column, so a quiet
          // column is not shaded by a busy one.
          const columnMax = (metric: string) =>
            Math.max(1, ...days.map((day) => count(byDay[day] ?? {}, view, metric)));
          const heat = (value: number, max: number) =>
            value === 0
              ? undefined
              : `color-mix(in srgb, var(--accent) ${Math.round(18 + (value / max) * 62)}%, #18181c)`;

          return (
            <section key={id} id={id} className="mt-6 scroll-mt-6">
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold">{title}</h2>
                    <p className="mt-1 max-w-2xl text-base leading-relaxed text-[#8f8f98]">
                      {subtitle}
                    </p>
                  </div>
                  <div className="flex gap-6">
                    <div>
                      <div className="text-sm text-[#9a9aa3]">First messages</div>
                      <div className="mt-1 text-4xl font-semibold leading-none tabular-nums">
                        {firstMessages}
                      </div>
                    </div>
                    {leads && (
                      <div>
                        <div className="text-sm text-[#9a9aa3]">Leads emailed</div>
                        <div
                          className="mt-1 text-4xl font-semibold leading-none tabular-nums"
                          style={{ color: leadCount > 0 ? "var(--accent)" : undefined }}
                        >
                          {leadCount}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6 grid gap-6 lg:grid-cols-3">
                  {/* WHERE PEOPLE DROP OFF */}
                  <div className="lg:col-span-2">
                    <h3 className="mb-3 text-base font-medium text-[#c9c9d0]">
                      Where people drop off
                    </h3>
                    <ul className="flex flex-col gap-1">
                      {funnel.map((metric, i) => {
                        const value = count(overall, view, metric);
                        return (
                          <li key={metric} className="rounded-2xl px-3 py-3 hover:bg-[#1c1c20]">
                            <div className="flex items-center gap-3">
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#26262b] text-sm font-semibold text-[#c9c9d0]">
                                {i + 1}
                              </span>
                              <span className="min-w-0 flex-1 text-base">{label(metric)}</span>
                              <span className="text-sm tabular-nums text-[#8f8f98]">
                                {pct(value, base)}
                              </span>
                              <span className="min-w-10 text-end text-xl font-semibold tabular-nums">
                                {value}
                              </span>
                            </div>
                            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[#26262b]">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${(value / biggest) * 100}%`,
                                  background: "var(--accent)",
                                  opacity: 1 - (i / Math.max(1, funnel.length)) * 0.5,
                                }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-3 text-sm text-[#8f8f98]">
                      {view.base === "opened"
                        ? "Percentages are of everyone who opened the bubble on this site."
                        : "Percentages are of everyone who sent a first message."}
                    </p>
                  </div>

                  {/* TOTALS */}
                  <div>
                    <h3 className="mb-3 text-base font-medium text-[#c9c9d0]">Totals</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {totals.map((metric) => (
                        <Tile key={metric} label={label(metric)} value={count(overall, view, metric)} />
                      ))}
                    </div>
                  </div>
                </div>

                {/* BY DAY — shaded by volume, so a quiet fortnight reads as quiet
                    instead of a wall of zeros. */}
                <h3 className="mb-3 mt-8 text-base font-medium text-[#c9c9d0]">
                  By day <span className="font-normal text-[#8f8f98]">· last {DAYS} days</span>
                </h3>
                <div className="overflow-x-auto rounded-2xl border border-[#26262b]">
                  <table className="w-full border-collapse whitespace-nowrap text-base">
                    <thead>
                      <tr className="border-b border-[#26262b] bg-[#16161a] text-sm text-[#9a9aa3]">
                        <th className="p-3 text-start font-medium">Day</th>
                        {funnel.map((m) => (
                          <th key={m} className="p-3 text-end font-medium">
                            {label(m).replace("Got ", "").replace(" the bubble", "")}
                          </th>
                        ))}
                        {leads && <th className="p-3 text-end font-medium">Leads</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((day) => {
                        const row = byDay[day] ?? {};
                        const dayLeads =
                          count(row, view, "lead_project") + count(row, view, "lead_template");
                        return (
                          <tr key={day} className="border-b border-[#1f1f24] last:border-0">
                            <td className="p-3 text-[#c9c9d0]">{day}</td>
                            {funnel.map((m) => {
                              const value = count(row, view, m);
                              return (
                                <td
                                  key={m}
                                  className={`p-3 text-end tabular-nums ${
                                    value === 0 ? "text-[#4b4b55]" : "font-medium text-white"
                                  }`}
                                  style={{ background: heat(value, columnMax(m)) }}
                                >
                                  {value === 0 ? "·" : value}
                                </td>
                              );
                            })}
                            {leads && (
                              <td
                                className={`p-3 text-end tabular-nums ${
                                  dayLeads === 0 ? "text-[#4b4b55]" : "font-semibold text-white"
                                }`}
                                style={{ background: heat(dayLeads, Math.max(1, dayLeads)) }}
                              >
                                {dayLeads === 0 ? "·" : dayLeads}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          );
        })}

        <Block
          id="buyers"
          title="Template buyers"
          note="From the Polar webhook, not the chat, so it belongs to neither site above. Did not consent counts both buyers who left the checkout box unticked and orders whose checkout never asked — so if it climbs while Added stays at zero, the consent field is not attached to the product they bought."
        >
          {BUYERS.map((metric) => (
            <Tile key={metric} label={LABELS[metric]} value={overall[metric] ?? 0} />
          ))}
        </Block>

        <Block
          id="audits"
          title="Website audits (/audit)"
          note="Started plus Reused is the number of leads that passed every check and reached your Resend list. Finished is audits that produced a report; Could not be audited is a site that was down, blocked us, or was not a web page. If Refused: storage unavailable is above zero, Upstash is missing or wrong in Vercel and nobody can submit."
        >
          {AUDITS.map((metric) => (
            <Tile key={metric} label={LABELS[metric]} value={overall[metric] ?? 0} />
          ))}
        </Block>
      </main>
    </Page>
  );
}
