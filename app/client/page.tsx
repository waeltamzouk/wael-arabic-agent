// The client dashboard: one site's numbers, view-only, for the client to open
// from a WhatsApp link.
//
// Guarded by `?key=` matched against `STATS_KEY_<SITE>` — a different secret
// per site, so a client's link can only ever show their own site. A wrong key,
// a missing key, an unknown site, or a site with no key set all render the same
// "Not found." and nothing else. Counts only: no names, phones or messages are
// stored anywhere, so there is nothing personal to leak.
//
// /stats (Wael's own page, all sites) is untouched.

import { timingSafeEqual } from "node:crypto";
import type { Metadata } from "next";
import { CLIENT_CONFIG, WHATSAPP_URL } from "@/lib/client-content";
import { isSite, siteMetric, type Site } from "@/lib/site";
import { lastDays, readTotals, statsDay, statsEnabled } from "@/lib/stats";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const NEAR_LIMIT = 0.8;

const TEXT = {
  ar: {
    title: "لوحة المساعد",
    month: "محادثات هذا الشهر",
    unit: "محادثة",
    near: "اقتربت من عدد المحادثات المضمّنة في باقتك.",
    over: "تجاوزت عدد المحادثات المضمّنة في باقتك. مساعدك يعمل كالمعتاد.",
    note: "المحادثة = زائر أرسل رسالة واحدة على الأقل.",
    funnel: "رحلة الزوار هذا الشهر",
    days: "آخر 30 يوماً",
    daysNote: "عدد المحادثات في كل يوم",
    content: "ما يعرفه مساعدك",
    updated: "آخر تحديث",
    try: "جرّب مساعدك",
    change: "اطلب تغييراً",
    unavailable: "الأرقام غير متاحة الآن. حاول لاحقاً.",
    steps: {
      opened: "فتحوا المحادثة",
      started: "كتبوا رسالة",
      engaged: "تفاعلوا مع الأسئلة",
      qualified: "أجابوا عن الأسئلة",
      form_shown: "ظهر لهم النموذج",
      form_submitted: "أرسلوا بياناتهم",
      discount_offered: "عُرض عليهم كود الخصم",
      discount_unlocked: "حصلوا على كود الخصم",
    } as Record<string, string>,
    whatsapp: (site: string) => `مرحباً وائل، أريد تغيير شيء في مساعدي (${site}): `,
  },
  en: {
    title: "Assistant dashboard",
    month: "Conversations this month",
    unit: "conversations",
    near: "You're close to the conversations included in your plan.",
    over: "You've gone past the conversations included in your plan. Your assistant keeps working as usual.",
    note: "A conversation = a visitor who sent at least one message.",
    funnel: "Visitor journey this month",
    days: "Last 30 days",
    daysNote: "Conversations per day",
    content: "What your assistant knows",
    updated: "Last updated",
    try: "Try your assistant",
    change: "Request a change",
    unavailable: "Numbers are not available right now. Please try again later.",
    steps: {
      opened: "Opened the chat",
      started: "Wrote a message",
      engaged: "Joined the questions",
      qualified: "Answered the questions",
      form_shown: "Saw the form",
      form_submitted: "Sent their details",
      discount_offered: "Were offered the discount code",
      discount_unlocked: "Got the discount code",
    } as Record<string, string>,
    whatsapp: (site: string) => `Hi Wael, I'd like to change something in my assistant (${site}): `,
  },
};

/** `STATS_KEY_<SITE>`, same naming rule as LEAD_TO_EMAIL_<SITE>. */
function keyFor(site: Site): string | undefined {
  // Trimmed, because a key pasted into Vercel often carries a trailing space or
  // line break. An empty result counts as "not set", so the page stays off.
  const value = process.env[`STATS_KEY_${site.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`]?.trim();
  return value || undefined;
}

function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function NotFound() {
  return (
    <main dir="ltr" className="p-8 text-sm text-neutral-500">
      Not found.
    </main>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border border-[#26262b] bg-[#151518] p-5 ${className}`}>
      {children}
    </section>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-4 text-sm font-medium text-[#9a9aa3]">{children}</h2>;
}

export default async function ClientPage({ searchParams }: PageProps<"/client">) {
  const params = await searchParams;
  const rawSite = typeof params.site === "string" ? params.site.trim().toLowerCase() : "";
  const key = typeof params.key === "string" ? params.key.trim() : "";

  // No fallback to the default site here (unlike siteFromParam): an unknown
  // site must show nothing, not the Arabic site's numbers.
  if (!isSite(rawSite)) return <NotFound />;
  const site = rawSite;
  const expected = keyFor(site);
  if (!expected || !keyMatches(key, expected)) return <NotFound />;

  const config = CLIENT_CONFIG[site];
  const t = TEXT[config.lang];
  const dir = config.lang === "ar" ? "rtl" : "ltr";

  // 31 days covers both "the last 30" and "since the 1st" (a month is at most
  // 31 days, and today counts as one of them).
  const days = lastDays(31);
  const today = statsDay();
  const monthPrefix = today.slice(0, 7);
  const monthDays = days.filter((d) => d.startsWith(monthPrefix));
  const chartDays = days.slice(0, 30).reverse();

  const metricFor = (name: string) => siteMetric(site, name);
  const metrics = [...new Set(["started", ...config.funnel])].map(metricFor);

  let byDay: Record<string, Record<string, number>> | null = null;
  if (statsEnabled()) {
    try {
      ({ byDay } = await readTotals(days, metrics));
    } catch (error) {
      // The reason stays in the logs — a client has nothing to do with it.
      console.error("Client stats read failed:", error);
    }
  }

  const shell = (children: React.ReactNode) => (
    <div
      data-site={site}
      dir={dir}
      className="min-h-screen w-full bg-[#0d0d0f] px-4 py-6 text-[#ededed] sm:py-10"
    >
      <main className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-4">{children}</main>
    </div>
  );

  if (!byDay) {
    return shell(
      <Card>
        <p className="text-sm text-[#9a9aa3]">{t.unavailable}</p>
      </Card>
    );
  }

  const get = (day: string, name: string) => byDay[day]?.[metricFor(name)] ?? 0;
  const monthSum = (name: string) => monthDays.reduce((sum, d) => sum + get(d, name), 0);

  const used = monthSum("started");
  const ratio = used / config.limit;
  const hot = ratio >= NEAR_LIMIT;
  const barColor = hot ? "var(--accent)" : "#4b4b55";

  const funnel = config.funnel.map((name) => ({ name, count: monthSum(name) }));
  const funnelMax = Math.max(1, ...funnel.map((s) => s.count));

  const chart = chartDays.map((day) => ({ day, count: get(day, "started") }));
  const chartMax = Math.max(1, ...chart.map((c) => c.count));

  const monthName = new Intl.DateTimeFormat(config.lang === "ar" ? "ar" : "en", {
    timeZone: "Asia/Riyadh",
    month: "long",
    year: "numeric",
  }).format(new Date());

  const whatsapp = `${WHATSAPP_URL}?text=${encodeURIComponent(t.whatsapp(site))}`;

  return shell(
    <>
      <header className="flex items-center justify-between px-1">
        <h1 className="text-lg font-semibold">{t.title}</h1>
        <span className="text-sm text-[#9a9aa3]">{monthName}</span>
      </header>

      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">{t.month}</h2>
          <div
            dir="ltr"
            className="text-sm font-semibold tabular-nums"
            style={{ color: hot ? "var(--accent)" : undefined }}
          >
            {used} / {config.limit}
          </div>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#26262b]">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, ratio * 100)}%`, background: barColor }}
          />
        </div>
        {hot && (
          <p className="mt-3 text-sm" style={{ color: "var(--accent)" }}>
            {ratio > 1 ? t.over : t.near}
          </p>
        )}
        <p className="mt-3 text-xs text-[#8a8a93]">{t.note}</p>
      </Card>

      <Card>
        <Heading>{t.funnel}</Heading>
        <ul className="flex flex-col gap-4">
          {funnel.map((step) => (
            <li key={step.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{t.steps[step.name]}</span>
                <span className="font-semibold tabular-nums">{step.count}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#26262b]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(step.count / funnelMax) * 100}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <Heading>
          {t.days} <span className="text-xs text-[#6d6d76]">· {t.daysNote}</span>
        </Heading>
        <div className="flex h-28 items-end gap-[3px]">
          {chart.map(({ day, count }) => (
            <div
              key={day}
              title={`${day}: ${count}`}
              className="flex-1 rounded-t-sm"
              style={{
                height: count ? `${Math.max(4, (count / chartMax) * 100)}%` : "2px",
                background: count ? "var(--accent)" : "#26262b",
              }}
            />
          ))}
        </div>
        <div dir="ltr" className="mt-2 flex justify-between text-[11px] text-[#6d6d76]">
          <span>{chartDays[0].slice(5)}</span>
          <span>{chartDays[chartDays.length - 1].slice(5)}</span>
        </div>
      </Card>

      <Card>
        <Heading>{t.content}</Heading>
        <ul className="flex flex-col divide-y divide-[#26262b]">
          {config.sections.map((section) => (
            <li key={section.title} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium">{section.title}</h3>
                <span className="shrink-0 text-xs text-[#8a8a93]">
                  {t.updated}: <span dir="ltr">{section.updated}</span>
                </span>
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-[#9a9aa3]">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <a
          href={`/embed?site=${site}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-2xl bg-[var(--accent)] px-5 py-3.5 text-center text-sm font-semibold text-white hover:opacity-90"
        >
          {t.try}
        </a>
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-2xl border border-[#26262b] bg-[#151518] px-5 py-3.5 text-center text-sm font-semibold hover:bg-[#1c1c20]"
        >
          {t.change}
        </a>
      </div>
    </>
  );
}
