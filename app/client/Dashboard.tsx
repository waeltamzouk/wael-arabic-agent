"use client";

// The interactive half of the client dashboard. The server page checks the key
// and reads the counters; everything here only DISPLAYS what it was handed.
// Nothing on this page writes anything, and it only ever receives ONE site's
// counts, so there is nothing for a client to reach beyond their own numbers.

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { TEXT, type Lang } from "@/app/client/text";

export type DayCounts = { day: string; c: Record<string, number> };
export type Section = { title: string; items: string[]; updated: string };

type Props = {
  site: string;
  lang: Lang;
  limit: number;
  funnel: string[];
  // Ascending, ending today (Riyadh). 62 days: this month and all of last.
  days: DayCounts[];
  monthName: string;
  sections: Section[];
  updatedAt: string;
  whatsappUrl: string;
};

type Range = "7" | "30" | "month";

const NEAR_LIMIT = 0.8;
const REFRESH_MS = 60_000;

const sum = (days: DayCounts[], name: string) =>
  days.reduce((total, d) => total + (d.c[name] ?? 0), 0);

const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";

function dayOfMonth(day: string) {
  return Number(day.slice(8, 10));
}

function daysInMonth(day: string) {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function lastMonthPrefix(day: string) {
  const [y, m] = day.split("-").map(Number);
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  return `${py}-${String(pm).padStart(2, "0")}`;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border border-[#26262b] bg-[#151518] p-5 ${className}`}>
      {children}
    </section>
  );
}

function Heading({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-medium text-[#c9c9d0]">{children}</h2>
      {hint && <p className="mt-0.5 text-xs text-[#6d6d76]">{hint}</p>}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 text-[#6d6d76] transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function Dashboard({
  site,
  lang,
  limit,
  funnel,
  days,
  monthName,
  sections,
  updatedAt,
  whatsappUrl,
}: Props) {
  const t = TEXT[lang];
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const [range, setRange] = useState<Range>("30");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  // Live update: ask the server for fresh numbers every minute while the tab is
  // in front, and as soon as the client comes back to it from WhatsApp.
  // `router.refresh()` re-runs the server page with the same address, so the key
  // stays on the server and the choices made here (range, open sections) stay.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  const today = days[days.length - 1].day;
  const monthPrefix = today.slice(0, 7);
  const elapsed = dayOfMonth(today);

  // ---- This month, against the plan -------------------------------------
  const monthDays = days.filter((d) => d.day.startsWith(monthPrefix));
  const used = sum(monthDays, "started");
  const ratio = used / limit;
  const hot = ratio >= NEAR_LIMIT;

  const lastPrefix = lastMonthPrefix(today);
  const lastDays = days.filter((d) => d.day.startsWith(lastPrefix));
  const lastTotal = sum(lastDays, "started");
  const lastSame = sum(
    lastDays.filter((d) => dayOfMonth(d.day) <= elapsed),
    "started"
  );
  const change = lastSame > 0 ? Math.round(((used - lastSame) / lastSame) * 100) : null;

  // A gentle estimate, and only once there are a few days to base it on.
  const projected =
    elapsed >= 3 && used > 0 ? Math.round((used / elapsed) * daysInMonth(today)) : null;

  // ---- The chosen period --------------------------------------------------
  const inRange =
    range === "month" ? monthDays : days.slice(-Number(range));
  const started = sum(inRange, "started");
  const average = inRange.length ? started / inRange.length : 0;
  const busiest = inRange.reduce<DayCounts | null>(
    (best, d) => ((d.c.started ?? 0) > (best?.c.started ?? 0) ? d : best),
    null
  );
  const langAr = sum(inRange, "lang_ar");
  const langEn = sum(inRange, "lang_en");
  const lastStep = funnel[funnel.length - 1];
  const outcome = sum(inRange, lastStep);

  const steps = funnel.map((name) => ({ name, count: sum(inRange, name) }));
  const funnelMax = Math.max(1, ...steps.map((s) => s.count));

  const chartMax = Math.max(1, ...inRange.map((d) => d.c.started ?? 0));
  const picked = selectedDay ? inRange.find((d) => d.day === selectedDay) : undefined;

  const dateFormat = new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const niceDay = (day: string) => dateFormat.format(new Date(`${day}T12:00:00Z`));

  const chooseRange = (next: Range) => {
    setRange(next);
    setSelectedDay(null);
  };

  const toggleSection = (title: string) =>
    setOpenSections((current) => {
      const next = new Set(current);
      if (!next.delete(title)) next.add(title);
      return next;
    });

  return (
    <>
      <header className="flex items-center justify-between gap-3 px-1">
        <h1 className="text-lg font-semibold">{t.title}</h1>
        <span className="text-sm text-[#9a9aa3]">{monthName}</span>
      </header>

      {/* THIS MONTH — always the plan month, whatever period is picked below. */}
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">{t.month}</h2>
          <div
            dir="ltr"
            className="text-sm font-semibold tabular-nums"
            style={{ color: hot ? "var(--accent)" : undefined }}
          >
            {used} / {limit}
          </div>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#26262b]">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.min(100, ratio * 100)}%`,
              background: hot ? "var(--accent)" : "#4b4b55",
            }}
          />
        </div>
        {hot && (
          <p className="mt-3 text-sm" style={{ color: "var(--accent)" }}>
            {ratio > 1 ? t.over : t.near}
          </p>
        )}
        <p className="mt-3 text-xs text-[#8a8a93]">{t.note}</p>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[#26262b] pt-4 text-sm">
          <div>
            <dt className="text-xs text-[#8a8a93]">{t.lastMonthSame}</dt>
            <dd className="mt-1 flex items-baseline gap-2 font-semibold tabular-nums">
              <bdi>{lastSame}</bdi>
              {change !== null && (
                <bdi
                  className="text-xs font-medium"
                  style={{ color: change >= 0 ? "var(--accent)" : "#9a9aa3" }}
                >
                  {change >= 0 ? "▲" : "▼"} {Math.abs(change)}%
                </bdi>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#8a8a93]">{t.lastMonthTotal}</dt>
            <dd className="mt-1 font-semibold tabular-nums">
              <bdi>{lastTotal}</bdi>
            </dd>
          </div>
        </dl>
        {projected !== null && (
          <p className="mt-4 text-xs text-[#9a9aa3]">
            {t.projected(String(projected))}
          </p>
        )}
      </Card>

      {/* PERIOD — drives the funnel, the chart and the small cards. */}
      <div className="flex items-center gap-3 px-1">
        <span className="text-xs text-[#8a8a93]">{t.rangeLabel}</span>
        <div className="flex flex-1 gap-1 rounded-2xl border border-[#26262b] bg-[#151518] p-1">
          {(["7", "30", "month"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={range === option}
              onClick={() => chooseRange(option)}
              className={`min-h-10 flex-1 rounded-xl px-2 text-sm font-medium transition-colors ${
                range === option
                  ? "bg-[var(--accent)] text-white"
                  : "text-[#9a9aa3] hover:bg-[#1c1c20]"
              }`}
            >
              {t.ranges[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-xs text-[#8a8a93]">{t.avg}</div>
          <div className="mt-1.5 text-xl font-semibold tabular-nums">
            <bdi>{average.toFixed(1)}</bdi>
          </div>
          <div className="mt-0.5 text-xs text-[#6d6d76]">{t.perDay}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-[#8a8a93]">{t.busiest}</div>
          <div className="mt-1.5 text-xl font-semibold tabular-nums">
            <bdi>{busiest && (busiest.c.started ?? 0) > 0 ? busiest.c.started : t.none}</bdi>
          </div>
          <div className="mt-0.5 truncate text-xs text-[#6d6d76]">
            {busiest && (busiest.c.started ?? 0) > 0 ? niceDay(busiest.day) : " "}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-[#8a8a93]">{t.steps[lastStep]}</div>
          <div className="mt-1.5 text-xl font-semibold tabular-nums">
            <bdi>{outcome}</bdi>
          </div>
          <div className="mt-0.5 text-xs text-[#6d6d76]">
            {t.ofConversations(pct(outcome, started))}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-[#8a8a93]">{t.language}</div>
          <div className="mt-1.5 text-sm font-semibold tabular-nums">
            {t.arabic} <bdi dir="ltr">{pct(langAr, langAr + langEn)}</bdi>
          </div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums">
            {t.english} <bdi dir="ltr">{pct(langEn, langAr + langEn)}</bdi>
          </div>
        </Card>
      </div>

      <Card>
        <Heading hint={t.funnelHint}>{t.funnel}</Heading>
        <ul className="flex flex-col gap-1">
          {steps.map((step, i) => {
            const open = openStep === step.name;
            const before = i > 0 ? steps[i - 1].count : null;
            return (
              <li key={step.name}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenStep(open ? null : step.name)}
                  className="w-full rounded-2xl px-2 py-2.5 text-start hover:bg-[#1c1c20]"
                >
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{t.steps[step.name]}</span>
                    <span className="font-semibold tabular-nums">{step.count}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#26262b]">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${(step.count / funnelMax) * 100}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                </button>
                {open && (
                  <div className="mx-2 mb-2 mt-1 rounded-2xl bg-[#1c1c20] p-3 text-sm text-[#c9c9d0]">
                    <p>{t.stepHelp[step.name]}</p>
                    {before !== null && before > 0 && (
                      <p className="mt-2 text-xs text-[#9a9aa3]">
                        {t.ofPrevious(pct(step.count, before))}
                        {step.count < before && <> · {t.fewer(String(before - step.count))}</>}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <Heading hint={t.chartHint}>{t.chart}</Heading>
        <div className="flex h-28 items-end gap-[3px]" role="group" aria-label={t.chart}>
          {inRange.map((d) => {
            const count = d.c.started ?? 0;
            const selected = selectedDay === d.day;
            return (
              <button
                key={d.day}
                type="button"
                aria-pressed={selected}
                aria-label={`${niceDay(d.day)}: ${count}`}
                onClick={() => setSelectedDay(selected ? null : d.day)}
                className="flex h-full min-w-0 flex-1 items-end"
              >
                <span
                  className="block w-full rounded-t-sm transition-opacity"
                  style={{
                    height: count ? `${Math.max(4, (count / chartMax) * 100)}%` : "2px",
                    background: count ? "var(--accent)" : "#26262b",
                    opacity: selectedDay && !selected ? 0.4 : 1,
                    outline: selected ? "2px solid #ededed" : "none",
                    outlineOffset: "1px",
                  }}
                />
              </button>
            );
          })}
        </div>
        {/* No dir="ltr" here: the bars run oldest-to-newest in the PAGE's
            direction, so under Arabic the oldest is on the right, and these
            labels must follow the same way. */}
        <div className="mt-2 flex justify-between text-[11px] text-[#6d6d76]">
          <bdi>{inRange[0].day.slice(5)}</bdi>
          <span>
            {t.max} <bdi>{chartMax}</bdi>
          </span>
          <bdi>{inRange[inRange.length - 1].day.slice(5)}</bdi>
        </div>

        {picked && (
          <div className="mt-4 rounded-2xl bg-[#1c1c20] p-3 text-sm">
            <div className="font-medium">{niceDay(picked.day)}</div>
            {(picked.c.started ?? 0) === 0 ? (
              <p className="mt-1 text-xs text-[#9a9aa3]">{t.noConversations}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5 text-xs text-[#c9c9d0]">
                {funnel.map((name) => (
                  <li key={name} className="flex items-baseline justify-between gap-3">
                    <span>{t.steps[name]}</span>
                    <span className="font-semibold tabular-nums">{picked.c[name] ?? 0}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card>
        <Heading hint={t.contentHint}>{t.content}</Heading>
        <ul className="flex flex-col gap-1">
          {sections.map((section) => {
            const open = openSections.has(section.title);
            return (
              <li key={section.title}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleSection(section.title)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl px-2 py-3 text-start hover:bg-[#1c1c20]"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{section.title}</span>
                    <span className="mt-0.5 block text-xs text-[#8a8a93]">
                      {t.items(section.items.length)} · {t.updated}:{" "}
                      <bdi>{section.updated}</bdi>
                    </span>
                  </span>
                  <Chevron open={open} />
                </button>
                {open && (
                  <ul className="mx-2 mb-2 mt-1 flex flex-col gap-1.5 rounded-2xl bg-[#1c1c20] p-3 text-sm text-[#c9c9d0]">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
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
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-2xl border border-[#26262b] bg-[#151518] px-5 py-3.5 text-center text-sm font-semibold hover:bg-[#1c1c20]"
        >
          {t.change}
        </a>
      </div>

      <div className="flex items-center justify-between gap-3 px-1 pb-4 text-xs text-[#6d6d76]">
        <span>{t.numbersAt(updatedAt)}</span>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => startRefresh(() => router.refresh())}
          className="min-h-10 rounded-xl border border-[#26262b] px-3 text-[#9a9aa3] hover:bg-[#151518] disabled:opacity-60"
        >
          {refreshing ? t.refreshing : t.refresh}
        </button>
      </div>
    </>
  );
}
