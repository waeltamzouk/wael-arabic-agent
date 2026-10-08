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
import Dashboard from "@/app/client/Dashboard";
import { TEXT } from "@/app/client/text";
import { CLIENT_CONFIG, WHATSAPP_URL } from "@/lib/client-content";
import { isSite, siteMetric, type Site } from "@/lib/site";
import { lastDays, readTotals, statsEnabled, whatsappMetric } from "@/lib/stats";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

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

  // 62 days is this month plus all of last month (each at most 31 days), which
  // is what "compared to last month" needs. Daily keys live for 90.
  const recent = lastDays(62);
  const names = [
    ...new Set([
      "started",
      "lang_ar",
      "lang_en",
      "starter_tap",
      ...config.funnel,
      ...(config.leadTypes ? ["lead_project", "lead_template"] : []),
    ]),
  ];
  const metricFor = (name: string) => siteMetric(site, name);
  // The WhatsApp channel is stored under its own prefix, not the site's.
  const waKey = whatsappMetric("started");
  const keys = [...names.map(metricFor), ...(config.whatsapp ? [waKey] : [])];

  let byDay: Record<string, Record<string, number>> | null = null;
  if (statsEnabled()) {
    try {
      ({ byDay } = await readTotals(recent, keys));
    } catch (error) {
      // The reason stays in the logs — a client has nothing to do with it.
      console.error("Client stats read failed:", error);
    }
  }

  // Full width: the dashboard lays out its own sidebar and content area.
  const shell = (children: React.ReactNode) => (
    <div data-site={site} dir={dir} className="min-h-screen w-full bg-[#0d0d0f] text-[#ededed]">
      {children}
    </div>
  );

  if (!byDay) {
    return shell(
      <main className="mx-auto max-w-xl p-6">
        <section className="rounded-3xl border border-[#26262b] bg-[#151518] p-5">
          <p className="text-base text-[#9a9aa3]">{t.unavailable}</p>
        </section>
      </main>
    );
  }

  // Oldest first, with the site's prefix stripped so the page only sees plain
  // names (`started`, not `templates_started`).
  const days = [...recent].reverse().map((day) => ({
    day,
    c: {
      ...Object.fromEntries(names.map((name) => [name, byDay[day]?.[metricFor(name)] ?? 0])),
      ...(config.whatsapp ? { wa_started: byDay[day]?.[waKey] ?? 0 } : {}),
    },
  }));

  const monthName = new Intl.DateTimeFormat(config.lang === "ar" ? "ar" : "en", {
    timeZone: "Asia/Riyadh",
    month: "long",
    year: "numeric",
  }).format(new Date());

  // Riyadh time, like every day boundary in the counters.
  const updatedAt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  return shell(
    <Dashboard
      site={site}
      siteName={config.name}
      extras={{ whatsapp: config.whatsapp, leadTypes: config.leadTypes }}
      lang={config.lang}
      limit={config.limit}
      funnel={[...config.funnel]}
      days={days}
      monthName={monthName}
      sections={config.sections}
      updatedAt={updatedAt}
      whatsappUrl={`${WHATSAPP_URL}?text=${encodeURIComponent(t.whatsapp(site))}`}
    />
  );
}
