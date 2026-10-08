"use client";

// The interactive half of the client dashboard. The server page checks the key
// and reads the counters; everything here only DISPLAYS what it was handed.
// Nothing on this page writes anything, and it only ever receives ONE site's
// counts, so there is nothing for a client to reach beyond their own numbers.
//
// Layout: a sidebar on a wide screen (a bottom tab bar on a phone) switches
// between four views — Overview, Journey, Activity, Content. The period switch
// (7 days / 30 days / this month) drives the first three. The plan month — the
// ring gauge — always means THIS month, whatever period is picked.

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { TEXT, type Lang } from "@/app/client/text";

export type DayCounts = { day: string; c: Record<string, number> };
export type Section = { title: string; items: string[]; updated: string };

type Props = {
  site: string;
  siteName: string;
  extras: { whatsapp: boolean; leadTypes: boolean };
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
type View = "overview" | "journey" | "activity" | "content";

const NEAR_LIMIT = 0.8;
const REFRESH_MS = 60_000;
const VIEWS: View[] = ["overview", "journey", "activity", "content"];
const VIEW_ICON: Record<View, string> = {
  overview: "home",
  journey: "funnel",
  activity: "pulse",
  content: "book",
};

// One focus ring for every control, in the brand colour.
const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";
const GROW = "transition-[width,height] duration-700 ease-out motion-reduce:transition-none";
const TINT = "color-mix(in srgb, var(--accent) 15%, transparent)";
const GREEN = "#4ade80";
const RED = "#f87171";

const sum = (days: DayCounts[], name: string) =>
  days.reduce((total, d) => total + (d.c[name] ?? 0), 0);

const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";

const delta = (now: number, before: number) =>
  before > 0 ? Math.round(((now - before) / before) * 100) : null;

const dayOfMonth = (day: string) => Number(day.slice(8, 10));

function daysInMonth(day: string) {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function lastMonthPrefix(day: string) {
  const [y, m] = day.split("-").map(Number);
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  return `${py}-${String(pm).padStart(2, "0")}`;
}

/** The next "round" number above `value` (1, 2, 5 × 10^k), at least 4. */
function niceMax(value: number) {
  const v = Math.max(4, value);
  const mag = 10 ** Math.floor(Math.log10(v));
  const norm = v / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

/** A smooth line through the points that never dips below the data (monotone cubic). */
function monotonePath(pts: [number, number][]) {
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
    } else {
      const a = t[i] / m[i];
      const b = t[i + 1] / m[i];
      const s = a * a + b * b;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        t[i] = tau * a * m[i];
        t[i + 1] = tau * b * m[i];
      }
    }
  }
  const r = (v: number) => Math.round(v * 100) / 100;
  let d = `M${r(pts[0][0])},${r(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    d += ` C${r(pts[i][0] + h / 3)},${r(pts[i][1] + (t[i] * h) / 3)} ${r(pts[i + 1][0] - h / 3)},${r(
      pts[i + 1][1] - (t[i + 1] * h) / 3
    )} ${r(pts[i + 1][0])},${r(pts[i + 1][1])}`;
  }
  return d;
}

// ---- Small pieces ----------------------------------------------------------

const ICONS: Record<string, string[]> = {
  home: ["M3 11l9-8 9 8", "M5 10v10h14V10"],
  funnel: ["M3 4h18l-7 8v6l-4 2v-8z"],
  pulse: ["M3 12h4l3-8 4 16 3-8h4"],
  book: ["M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z", "M4 19V5"],
  trend: ["M3 17l6-6 4 4 8-8", "M15 7h6v6"],
  refresh: ["M21 12a9 9 0 11-3-6.7", "M21 4v5h-5"],
  arrow: ["M5 12h14", "M13 6l6 6-6 6"],
  chat: ["M21 12a8 8 0 01-11.6 7.1L4 20l1.1-4.6A8 8 0 1121 12z"],
  chevron: ["M6 9l6 6 6-6"],
  panel: ["M4 5h16v14H4z", "M9 5v14"],
  sparkle: ["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"],
  up: ["M12 19V5", "M6 11l6-6 6 6"],
  down: ["M12 5v14", "M6 13l6 6 6-6"],
};

function Icon({
  name,
  size = 20,
  className = "",
  stroke = 1.8,
}: {
  name: string;
  size?: number;
  className?: string;
  stroke?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-3xl border border-[#26262b] bg-gradient-to-b from-[#18181c] to-[#131316] p-5 sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

function Heading({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-semibold">{children}</h2>
      {hint && <p className="mt-1 text-sm text-[#8f8f98]">{hint}</p>}
    </div>
  );
}

/** ▲ 2.7% in green, ▼ 1.3% in red, — when there is nothing to compare with. */
function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[#8f8f98]">—</span>;
  const color = value > 0 ? GREEN : value < 0 ? RED : "#8f8f98";
  return (
    <bdi className="inline-flex items-center gap-1.5 font-medium" style={{ color }}>
      <span
        className="grid size-4 place-items-center rounded-full text-[#0d0d0f]"
        style={{ background: color }}
      >
        {value !== 0 && <Icon name={value > 0 ? "up" : "down"} size={10} stroke={3} />}
      </span>
      {Math.abs(value)}%
    </bdi>
  );
}

/** A row of thin ticks, filled from the start — the "78%" bar in the picture. */
function TickBar({ ratio, ready, hot }: { ratio: number; ready: boolean; hot?: boolean }) {
  const N = 48;
  const filled = ready ? Math.round(Math.min(1, ratio) * N) : 0;
  return (
    <div className="flex h-9 items-stretch gap-[3px]" aria-hidden="true">
      {Array.from({ length: N }, (_, i) => (
        <span
          key={i}
          className="flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none"
          style={{
            transitionDelay: `${i * 8}ms`,
            background: i < filled ? (hot ? "var(--accent)" : "#d4d4d8") : "#2c2c32",
          }}
        />
      ))}
    </div>
  );
}

/** The plan ring: a 270° arc of small ticks, filled by how much of the month is used. */
function RingGauge({
  ratio,
  used,
  limit,
  hot,
  rtl,
  ready,
  label,
}: {
  ratio: number;
  used: number;
  limit: number;
  hot: boolean;
  rtl: boolean;
  ready: boolean;
  label: string;
}) {
  const N = 64;
  const filled = ready ? Math.min(N, Math.max(used > 0 ? 1 : 0, Math.round(ratio * N))) : 0;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[280px]">
      <svg viewBox="0 0 240 240" className={`absolute inset-0 size-full ${rtl ? "-scale-x-100" : ""}`} aria-hidden="true">
        {Array.from({ length: N }, (_, i) => {
          const a = ((135 + (i * 270) / (N - 1)) * Math.PI) / 180;
          const [c, s] = [Math.cos(a), Math.sin(a)];
          // Rounded: the server and the browser print the last float digits
          // differently, and a mismatch is a hydration error.
          const at = (r: number, v: number) => Math.round((120 + v * r) * 100) / 100;
          return (
            <line
              key={i}
              x1={at(90, c)}
              y1={at(90, s)}
              x2={at(108, c)}
              y2={at(108, s)}
              strokeWidth="4.5"
              strokeLinecap="round"
              className="transition-[stroke] duration-300 motion-reduce:transition-none"
              style={{
                transitionDelay: `${i * 10}ms`,
                stroke: i < filled ? (hot ? "var(--accent)" : "#d4d4d8") : "#2c2c32",
              }}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-12 text-center">
        <span className="mb-2 flex size-11 items-center justify-center rounded-full border border-[#2a2a30] bg-[#1c1c20] text-[#c9c9d0]">
          <Icon name="chat" size={20} />
        </span>
        <span className="text-sm leading-snug text-[#9a9aa3]">{label}</span>
        <span
          className="mt-1 text-5xl font-bold leading-none tabular-nums"
          style={{ color: hot ? "var(--accent)" : undefined }}
        >
          <bdi>{used}</bdi>
        </span>
        <span className="mt-1.5 text-lg text-[#8f8f98] tabular-nums">
          / <bdi>{limit}</bdi>
        </span>
      </div>
    </div>
  );
}

/** Rows of "label — number — share" with a bar under each. */
function BarRows({
  rows,
  total,
  scale,
  ready,
}: {
  rows: { label: string; count: number; color: string }[];
  total: number;
  scale?: number;
  ready: boolean;
}) {
  const full = scale ?? total;
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-base">
            <span>{row.label}</span>
            <span className="flex items-baseline gap-2">
              <bdi className="font-semibold tabular-nums">{row.count}</bdi>
              <bdi className="text-sm text-[#8f8f98]">{pct(row.count, total)}</bdi>
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#26262b]">
            <div
              className={`h-full rounded-full ${GROW}`}
              style={{
                width: ready && full ? `${(row.count / full) * 100}%` : "0%",
                background: row.color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Conversations per day: a smooth area line, a crosshair and a tooltip on hover. */
function AreaChart({
  data,
  rtl,
  average,
  selectedDay,
  onSelect,
  ready,
  t,
  funnel,
  niceDay,
}: {
  data: DayCounts[];
  rtl: boolean;
  average: number;
  selectedDay: string | null;
  onSelect: (day: string | null) => void;
  ready: boolean;
  t: (typeof TEXT)[Lang];
  funnel: string[];
  niceDay: (day: string) => string;
}) {
  const id = useId();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const n = data.length;
  const counts = data.map((d) => d.c.started ?? 0);
  const top = niceMax(Math.max(...counts, 1));
  const lastStep = funnel[funnel.length - 1];

  // Oldest day sits at the START of the line: the left in English, the right in
  // Arabic, which is also where the y-axis numbers go.
  const fx = (i: number) => (n < 2 ? 0.5 : rtl ? 1 - i / (n - 1) : i / (n - 1));
  const fy = (count: number) => 1 - count / top;

  const pts = data
    .map((_, i) => [fx(i) * 100, fy(counts[i]) * 100] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const line = n >= 2 ? monotonePath(pts) : "";

  const selectedIdx = selectedDay ? data.findIndex((d) => d.day === selectedDay) : -1;
  const active = hoverIdx ?? (selectedIdx >= 0 ? selectedIdx : null);
  const activeDay = active !== null ? data[active] : null;

  const indexAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (rtl) f = 1 - f;
    return n < 2 ? 0 : Math.round(f * (n - 1));
  };

  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const labelAt = [...new Set([0, 1, 2, 3, 4].map((k) => Math.round((k * (n - 1)) / 4)))];

  return (
    <div>
      <div className="flex gap-3">
        <div className="relative h-60 w-9 shrink-0 text-sm tabular-nums text-[#8f8f98]" aria-hidden="true">
          {ticks.map((f) => (
            <span
              key={f}
              className="absolute end-0 -translate-y-1/2 leading-none"
              style={{ top: `${(1 - f) * 100}%` }}
            >
              {Math.round(top * f)}
            </span>
          ))}
        </div>

        <div className="relative h-60 min-w-0 flex-1">
          <svg
            className="absolute inset-0 size-full overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                {/* style, not attributes: var() is not resolved in SVG presentation attributes. */}
                <stop offset="0%" style={{ stopColor: "var(--accent)", stopOpacity: 0.38 }} />
                <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            {ticks.map((f) => (
              <line
                key={f}
                x1="0"
                x2="100"
                y1={(1 - f) * 100}
                y2={(1 - f) * 100}
                stroke="#26262b"
                strokeWidth="1"
                strokeDasharray="3 5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {n >= 2 && (
              <g
                className="transition-opacity duration-700 motion-reduce:transition-none"
                style={{ opacity: ready ? 1 : 0 }}
              >
                <path d={`${line} L100,100 L0,100 Z`} fill={`url(#${id}-fill)`} />
                <path
                  d={line}
                  fill="none"
                  style={{ stroke: "var(--accent)" }}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
          </svg>

          {average > 0 && (
            <div
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[#8f8f98]/70"
              style={{ top: `${fy(average) * 100}%` }}
              aria-hidden="true"
            />
          )}

          {activeDay && active !== null && (
            <>
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-[#55555e]"
                style={{ left: `${fx(active) * 100}%` }}
              />
              <div
                className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0d0d0f] bg-[var(--accent)] ring-2 ring-[var(--accent)]/40"
                style={{ left: `${fx(active) * 100}%`, top: `${fy(counts[active]) * 100}%` }}
              />
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full z-10 mb-3 w-52 -translate-x-1/2 rounded-2xl border border-[#33333a] bg-[#1c1c20] p-3 shadow-lg shadow-black/50"
                style={{ left: `clamp(104px, ${fx(active) * 100}%, calc(100% - 104px))` }}
              >
                <div className="text-base font-medium">{niceDay(activeDay.day)}</div>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm text-[#c9c9d0]">
                  {[...new Set([funnel[0], "started", lastStep])].map((name) => (
                    <li key={name} className="flex items-baseline justify-between gap-3">
                      <span>{t.steps[name]}</span>
                      <span className="font-semibold tabular-nums">{activeDay.c[name] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {/* The whole plot listens, so the crosshair follows the pointer. */}
          <div
            className="absolute inset-0 cursor-crosshair touch-pan-y"
            role="img"
            aria-label={t.chart}
            onPointerMove={(e) => setHoverIdx(indexAt(e))}
            onPointerLeave={() => setHoverIdx(null)}
            onClick={(e) => {
              const i = indexAt(e as unknown as React.PointerEvent<HTMLDivElement>);
              onSelect(selectedDay === data[i].day ? null : data[i].day);
            }}
          />
        </div>
      </div>

      {/* Labels run in the page's direction, the same way the line does. */}
      <div className="mt-3 flex justify-between ps-12 text-sm tabular-nums text-[#8f8f98]">
        {labelAt.map((i) => (
          <bdi key={i}>{data[i].day.slice(5)}</bdi>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard({
  site,
  siteName,
  extras,
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
  const rtl = lang === "ar";
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const [view, setView] = useState<View>("overview");
  const [range, setRange] = useState<Range>("30");
  const [collapsed, setCollapsed] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  // Bars and gauges grow in on first paint. The numbers are already in the
  // HTML, so this is decoration only.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Live update: ask the server for fresh numbers every minute while the tab is
  // in front, and as soon as the client comes back to it from WhatsApp.
  // `router.refresh()` re-runs the server page with the same address, so the key
  // stays on the server and the choices made here (view, range) stay.
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
  const lastSameDays = lastDays.filter((d) => dayOfMonth(d.day) <= elapsed);
  const lastSame = sum(lastSameDays, "started");
  const change = delta(used, lastSame);

  // A gentle estimate, and only once there are a few days to base it on.
  const projected =
    elapsed >= 3 && used > 0 ? Math.round((used / elapsed) * daysInMonth(today)) : null;

  // ---- The chosen period, and the one just before it ----------------------
  const inRange = range === "month" ? monthDays : days.slice(-Number(range));
  const before =
    range === "7" ? days.slice(-14, -7) : range === "30" ? days.slice(-60, -30) : lastSameDays;

  const started = sum(inRange, "started");
  const average = inRange.length ? started / inRange.length : 0;
  const beforeAverage = before.length ? sum(before, "started") / before.length : 0;
  const busiest = inRange.reduce<DayCounts | null>(
    (best, d) => ((d.c.started ?? 0) > (best?.c.started ?? 0) ? d : best),
    null
  );
  const hasBusiest = !!busiest && (busiest.c.started ?? 0) > 0;
  const langAr = sum(inRange, "lang_ar");
  const langEn = sum(inRange, "lang_en");
  const langTotal = langAr + langEn;
  const lastStep = funnel[funnel.length - 1];
  const outcome = sum(inRange, lastStep);

  const steps = funnel.map((name) => ({ name, count: sum(inRange, name) }));
  const funnelMax = Math.max(1, ...steps.map((s) => s.count));
  const picked = selectedDay ? inRange.find((d) => d.day === selectedDay) : undefined;

  const loc = lang === "ar" ? "ar" : "en";
  const dateFormat = new Intl.DateTimeFormat(loc, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const shortFormat = new Intl.DateTimeFormat(loc, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const niceDay = (day: string) => dateFormat.format(new Date(`${day}T12:00:00Z`));
  const shortDay = (day: string) => shortFormat.format(new Date(`${day}T12:00:00Z`));

  const insight = t.insight(used, change);

  // ---- Extra cards ----------------------------------------------------------
  const taps = sum(inRange, "starter_tap");
  const waStarted = sum(inRange, "wa_started");
  const leadProject = sum(inRange, "lead_project");
  const leadTemplate = sum(inRange, "lead_template");

  // Busiest weekdays, from every day we have (about two months) rather than the
  // chosen period: seven days holds each weekday once, which is noise. Sunday
  // first — the Gulf working week.
  const weekdayFormat = new Intl.DateTimeFormat(loc, { timeZone: "UTC", weekday: "long" });
  const weekdayCounts = Array.from({ length: 7 }, () => 0);
  for (const d of days) {
    weekdayCounts[new Date(`${d.day}T12:00:00Z`).getUTCDay()] += d.c.started ?? 0;
  }
  const weekdayTotal = weekdayCounts.reduce((a, b) => a + b, 0);
  const weekdayOrder = weekdayCounts.map((_, i) => i).sort((a, b) => weekdayCounts[b] - weekdayCounts[a]);
  const weekdayName = (i: number) => weekdayFormat.format(new Date(Date.UTC(2023, 0, 1 + i)));
  const [first, second] = weekdayOrder;
  const average7 = weekdayTotal / 7;
  const weekdaySentence =
    weekdayTotal < 14
      ? t.weekdayFew
      : weekdayCounts[first] < average7 * 1.25
        ? t.weekdayEven
        : weekdayCounts[second] >= weekdayCounts[first] * 0.8
          ? t.weekdayTwo(weekdayName(Math.min(first, second)), weekdayName(Math.max(first, second)))
          : t.weekdayOne(weekdayName(first));
  const weekdayHot = new Set(
    weekdayTotal >= 14 && weekdayCounts[first] >= average7 * 1.25
      ? weekdayOrder.filter((i) => weekdayCounts[i] >= weekdayCounts[first] * 0.8).slice(0, 2)
      : []
  );

  const chooseRange = (next: Range) => {
    setRange(next);
    setSelectedDay(null);
  };
  const chooseView = (next: View) => {
    setView(next);
    window.scrollTo({ top: 0 });
  };
  const toggleSection = (title: string) =>
    setOpenSections((current) => {
      const next = new Set(current);
      if (!next.delete(title)) next.add(title);
      return next;
    });

  const usesRange = view !== "content";
  const viewTitle =
    view === "journey" ? t.funnel : view === "content" ? t.content : t.nav[view];

  // ---- Pieces that appear in more than one place --------------------------

  const periodSwitch = (
    <div
      className="flex gap-1 rounded-2xl border border-[#26262b] bg-[#151518] p-1"
      role="group"
      aria-label={t.rangeLabel}
    >
      {(["7", "30", "month"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={range === option}
          onClick={() => chooseRange(option)}
          className={`min-h-10 flex-1 whitespace-nowrap rounded-xl px-4 text-base font-medium transition-colors ${FOCUS} ${
            range === option
              ? "bg-[var(--accent)] text-white"
              : "text-[#9a9aa3] hover:bg-[#1c1c20] hover:text-[#ededed]"
          }`}
        >
          {t.ranges[option]}
        </button>
      ))}
    </div>
  );

  const refreshButton = (
    <button
      type="button"
      disabled={refreshing}
      onClick={() => startRefresh(() => router.refresh())}
      aria-label={t.refresh}
      title={t.numbersAt(updatedAt)}
      className={`flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[#26262b] bg-[#151518] text-[#c9c9d0] hover:bg-[#1c1c20] ${FOCUS}`}
    >
      <Icon name="refresh" size={20} className={refreshing ? "animate-spin" : ""} />
    </button>
  );

  const brandBadge = (
    <span
      className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] text-white shadow-[0_0_24px_-4px_var(--accent)]"
      aria-hidden="true"
    >
      <span className="size-3.5 rounded-full bg-white" />
    </span>
  );

  const livePill = (
    <span className="flex items-center gap-1.5 text-sm" style={{ color: GREEN }}>
      <span className="size-2 rounded-full" style={{ background: GREEN }} />
      {t.live}
    </span>
  );

  const tryLink = (iconOnly: boolean) => (
    <a
      href={`/embed?site=${site}`}
      target="_blank"
      rel="noopener noreferrer"
      title={t.try}
      aria-label={t.try}
      className={`flex items-center justify-center gap-2.5 rounded-2xl bg-[var(--accent)] font-semibold text-white shadow-[0_0_28px_-6px_var(--accent)] transition-opacity hover:opacity-90 ${FOCUS} ${
        iconOnly ? "size-11" : "px-4 py-3.5 text-base"
      }`}
    >
      {!iconOnly && t.try}
      <Icon name="arrow" size={18} className="rtl:-scale-x-100" />
    </a>
  );

  const changeLink = (iconOnly: boolean) => (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={t.change}
      aria-label={t.change}
      className={`flex items-center justify-center gap-2.5 rounded-2xl border border-[#33333a] bg-[#16161a] font-semibold transition-colors hover:bg-[#1c1c20] ${FOCUS} ${
        iconOnly ? "size-11" : "px-4 py-3.5 text-base"
      }`}
    >
      <Icon name="chat" size={18} />
      {!iconOnly && t.change}
    </a>
  );

  // The two buttons for a phone, where there is no sidebar card.
  const phoneActions = (
    <div className="flex flex-col gap-3 sm:flex-row lg:hidden">
      <div className="flex-1 [&>a]:w-full">{tryLink(false)}</div>
      <div className="flex-1 [&>a]:w-full">{changeLink(false)}</div>
    </div>
  );

  const glow = rtl ? "to left" : "to right";

  // ---- The four views ---------------------------------------------------------

  const gaugeCard = (
    <Card className="xl:col-start-2 xl:row-span-2 xl:row-start-1">
      {/* Ring on one side and the details on the other from `lg`; stacked when
          the card is the narrow column (xl) or on a phone. */}
      <div className="grid items-center gap-6 lg:grid-cols-2 xl:grid-cols-1">
        <div>
          <RingGauge
            ratio={ratio}
            used={used}
            limit={limit}
            hot={hot}
            rtl={rtl}
            ready={ready}
            label={t.month}
          />
          <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-[#9a9aa3]">
            <span className="flex items-center gap-2">
              <span
                className="size-2.5 rounded-full"
                style={{ background: hot ? "var(--accent)" : "#d4d4d8" }}
              />
              {t.usedLabel} <bdi className="tabular-nums">{pct(used, limit)}</bdi>
            </span>
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-[#2c2c32]" />
              {t.remainingLabel} <bdi className="tabular-nums">{Math.max(0, limit - used)}</bdi>
            </span>
          </div>
        </div>

        <div>
          {hot && (
            <p
              className="mb-5 rounded-2xl p-3 text-base leading-relaxed"
              style={{ color: "var(--accent)", background: TINT }}
            >
              {ratio > 1 ? t.over : t.near}
            </p>
          )}

          <dl className="flex flex-col gap-4 border-t border-[#26262b] pt-5 lg:border-t-0 lg:pt-0 xl:border-t xl:pt-5">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-base text-[#9a9aa3]">{t.lastMonthSame}</dt>
              <dd className="flex items-center gap-3 text-lg font-semibold tabular-nums">
                <Delta value={change} />
                <bdi>{lastSame}</bdi>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-base text-[#9a9aa3]">{t.lastMonthTotal}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                <bdi>{lastTotal}</bdi>
              </dd>
            </div>
          </dl>
          {projected !== null && (
            <p className="mt-4 text-base leading-relaxed text-[#c9c9d0]">
              {t.projected(String(projected))}
            </p>
          )}
          <p className="mt-4 text-sm text-[#8f8f98]">{t.note}</p>
        </div>
      </div>
    </Card>
  );

  const kpis: { label: string; value: React.ReactNode; foot: React.ReactNode }[] = [
    {
      label: t.colConv,
      value: started,
      foot: <Delta value={delta(started, sum(before, "started"))} />,
    },
    {
      label: t.avg,
      value: average.toFixed(1),
      foot: <Delta value={delta(average, beforeAverage)} />,
    },
    {
      label: t.steps[lastStep],
      value: outcome,
      foot: <Delta value={delta(outcome, sum(before, lastStep))} />,
    },
    {
      label: t.busiest,
      value: hasBusiest ? busiest.c.started : t.none,
      foot: <span className="text-[#8f8f98]">{hasBusiest ? niceDay(busiest.day) : " "}</span>,
    },
  ];

  const overview = (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      {gaugeCard}

      <Card className="xl:col-start-1 xl:row-start-1">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
          {kpis.map((k, i) => (
            <div
              key={k.label}
              className="min-w-0"
            >
              <dt className="text-sm leading-snug text-[#9a9aa3]">{k.label}</dt>
              <dd className="mt-2 text-4xl font-semibold tabular-nums leading-none">
                <bdi>{k.value}</bdi>
              </dd>
              <dd className="mt-2.5 flex flex-wrap items-center gap-x-2 text-sm">
                {k.foot}
                {i < 3 && <span className="text-[#6f6f78]">{t.vsPrior}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="xl:col-start-1 xl:row-start-2">
        <Heading hint={t.chartHint}>{t.chart}</Heading>
        <AreaChart
          data={inRange}
          rtl={rtl}
          average={average}
          selectedDay={selectedDay}
          onSelect={setSelectedDay}
          ready={ready}
          t={t}
          funnel={funnel}
          niceDay={niceDay}
        />
        <div className="mt-4 flex items-center gap-2 text-sm text-[#8f8f98]">
          <span className="w-5 border-t border-dashed border-[#8f8f98]" aria-hidden="true" />
          {t.avg} <bdi>{average.toFixed(1)}</bdi>
        </div>
        {started === 0 && (
          <p className="mt-4 rounded-2xl bg-[#1c1c20] p-3 text-base text-[#9a9aa3]">{t.empty}</p>
        )}
        {picked && (
          <div className="mt-4 rounded-2xl bg-[#1c1c20] p-4">
            <div className="text-base font-medium">{niceDay(picked.day)}</div>
            {(picked.c.started ?? 0) === 0 ? (
              <p className="mt-1 text-sm text-[#9a9aa3]">{t.noConversations}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2 text-base text-[#c9c9d0]">
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

      <Card className="xl:col-span-2">
        <div className="flex items-start gap-4">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-[var(--accent)]"
            style={{ background: TINT }}
          >
            <Icon name="sparkle" size={20} />
          </span>
          <p className="text-2xl leading-snug text-[#8f8f98] sm:text-3xl">
            {insight.pre}
            <span className="font-semibold text-[#ededed]">{insight.strong}</span>
            {insight.post}
          </p>
        </div>
      </Card>

      {phoneActions}
    </div>
  );

  const journey = (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <p className="mb-5 text-base text-[#8f8f98]">{t.funnelHint}</p>
        <ul className="flex flex-col gap-1">
          {steps.map((step, i) => {
            const open = openStep === step.name;
            const prev = i > 0 ? steps[i - 1].count : null;
            return (
              <li key={step.name}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenStep(open ? null : step.name)}
                  className={`w-full rounded-2xl px-3 py-3.5 text-start transition-colors hover:bg-[#1c1c20] ${FOCUS} ${
                    open ? "bg-[#1c1c20]" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#26262b] text-sm font-semibold text-[#c9c9d0]">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-base">{t.steps[step.name]}</span>
                    {prev !== null && prev > 0 && (
                      <bdi className="text-sm text-[#8f8f98]">{pct(step.count, prev)}</bdi>
                    )}
                    <span className="min-w-8 text-end text-lg font-semibold tabular-nums">{step.count}</span>
                  </div>
                  <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[#26262b]">
                    <div
                      className={`h-full rounded-full ${GROW}`}
                      style={{
                        width: ready ? `${(step.count / funnelMax) * 100}%` : "0%",
                        background: "var(--accent)",
                        opacity: 1 - (i / Math.max(1, steps.length)) * 0.5,
                      }}
                    />
                  </div>
                </button>
                {open && (
                  <div className="mx-3 mb-2 mt-1 rounded-2xl bg-[#1c1c20] p-4 text-base leading-relaxed text-[#c9c9d0]">
                    <p>{t.stepHelp[step.name]}</p>
                    {prev !== null && prev > 0 && (
                      <p className="mt-2 text-sm text-[#9a9aa3]">
                        {t.ofPrevious(pct(step.count, prev))}
                        {step.count < prev && <> · {t.fewer(String(prev - step.count))}</>}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <div className="text-sm text-[#9a9aa3]">{t.steps[lastStep]}</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-5xl font-semibold leading-none tabular-nums">
              <bdi>{outcome}</bdi>
            </span>
            <span className="text-base text-[#8f8f98]">{t.ofConversations(pct(outcome, started))}</span>
          </div>
          <div className="mt-5">
            <TickBar ratio={started > 0 ? outcome / started : 0} ready={ready} />
          </div>
        </Card>

        <Card>
          <div className="text-sm text-[#9a9aa3]">{t.language}</div>
          <ul className="mt-4 flex flex-col gap-4">
            {[
              { label: t.arabic, count: langAr, color: "var(--accent)" },
              { label: t.english, count: langEn, color: "#7a7a86" },
            ].map((row) => (
              <li key={row.label}>
                <div className="flex items-baseline justify-between text-base">
                  <span>{row.label}</span>
                  <bdi className="font-semibold tabular-nums">{pct(row.count, langTotal)}</bdi>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#26262b]">
                  <div
                    className={`h-full rounded-full ${GROW}`}
                    style={{
                      width: ready && langTotal ? `${(row.count / langTotal) * 100}%` : "0%",
                      background: row.color,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:col-span-2 xl:grid-cols-3">
        {extras.whatsapp && (
          <Card>
            <div className="mb-4 text-sm text-[#9a9aa3]">{t.channelsTitle}</div>
            <BarRows
              ready={ready}
              total={started + waStarted}
              rows={[
                { label: t.channelWebsite, count: started, color: "var(--accent)" },
                { label: t.channelWhatsapp, count: waStarted, color: "#4ade80" },
              ]}
            />
          </Card>
        )}
        <Card>
          <div className="text-sm text-[#9a9aa3]">{t.startersTitle}</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-5xl font-semibold leading-none tabular-nums">
              <bdi>{taps}</bdi>
            </span>
            <span className="text-base text-[#8f8f98]">{t.ofConversations(pct(taps, started))}</span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-[#8f8f98]">{t.startersHint}</p>
        </Card>
        {extras.leadTypes && (
          <Card className="md:col-span-2 xl:col-span-1">
            <div className="mb-4 text-sm text-[#9a9aa3]">{t.leadTypesTitle}</div>
            <BarRows
              ready={ready}
              total={leadProject + leadTemplate}
              rows={[
                { label: t.leadProject, count: leadProject, color: "var(--accent)" },
                { label: t.leadTemplate, count: leadTemplate, color: "#7a7a86" },
              ]}
            />
          </Card>
        )}
      </div>
    </div>
  );

  const rows = [...inRange].reverse();
  const weekdayCard = (
    <Card>
      <h2 className="text-lg font-semibold">{t.weekdayTitle}</h2>
      <p className="mt-2 text-xl leading-snug text-[#c9c9d0]">{weekdaySentence}</p>
      <p className="mb-5 mt-1 text-sm text-[#8f8f98]">{t.weekdayBasis}</p>
      {weekdayTotal >= 14 && (
        <BarRows
          ready={ready}
          total={weekdayTotal}
          scale={Math.max(1, ...weekdayCounts)}
          rows={weekdayCounts.map((count, i) => ({
            label: weekdayName(i),
            count,
            color: weekdayHot.has(i) ? "var(--accent)" : "#4b4b55",
          }))}
        />
      )}
    </Card>
  );

  const activity = (
    <div className="flex flex-col gap-4">
      {weekdayCard}
    <Card className="!px-3 sm:!px-4">
      <div
        className="grid grid-cols-[1.5fr_1fr_1.6fr_1fr] items-end gap-2 border-b border-[#26262b] px-2 pb-3 text-sm leading-tight text-[#8f8f98] sm:px-3"
        role="row"
      >
        <span>{t.colDay}</span>
        <span>{t.steps[funnel[0]]}</span>
        <span>{t.colConv}</span>
        <span>{t.steps[lastStep]}</span>
      </div>
      <ul>
        {rows.map((d) => {
          const count = d.c.started ?? 0;
          const best = hasBusiest && busiest.day === d.day;
          return (
            <li
              key={d.day}
              className={`grid grid-cols-[1.5fr_1fr_1.6fr_1fr] items-center gap-2 rounded-xl px-2 py-3 text-base tabular-nums sm:px-3 ${
                best ? "bg-[#1a1a1f]" : ""
              }`}
            >
              <span className="text-[#c9c9d0]">{shortDay(d.day)}</span>
              <span className="text-[#9a9aa3]">{d.c[funnel[0]] ?? 0}</span>
              <span className="flex items-center gap-2.5">
                <span className="w-6 font-semibold">{count}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#26262b]">
                  <span
                    className={`block h-full rounded-full ${GROW}`}
                    style={{
                      width: ready ? `${(count / Math.max(1, ...inRange.map((x) => x.c.started ?? 0))) * 100}%` : "0%",
                      background: "var(--accent)",
                    }}
                  />
                </span>
              </span>
              <span className="font-semibold">{d.c[lastStep] ?? 0}</span>
            </li>
          );
        })}
      </ul>
    </Card>
    </div>
  );

  const content = (
    <div className="flex flex-col gap-4">
      <Card>
        <p className="mb-5 text-base text-[#8f8f98]">{t.contentHint}</p>
        <ul className="grid gap-2 md:grid-cols-2">
          {sections.map((section) => {
            const open = openSections.has(section.title);
            return (
              <li
                key={section.title}
                className={`self-start rounded-2xl border transition-colors ${
                  open ? "border-[#33333a] bg-[#1c1c20]" : "border-[#26262b] bg-[#16161a]"
                }`}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleSection(section.title)}
                  className={`flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-start ${FOCUS}`}
                >
                  <span className="min-w-0">
                    <span className="block text-base font-medium">{section.title}</span>
                    <span className="mt-0.5 block text-sm text-[#8f8f98]">
                      {t.items(section.items.length)} · {t.updated}: <bdi>{section.updated}</bdi>
                    </span>
                  </span>
                  <Icon
                    name="chevron"
                    size={20}
                    className={`text-[#8f8f98] transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>
                {open && (
                  <ul className="flex flex-col gap-2 px-4 pb-4 text-base text-[#c9c9d0]">
                    {section.items.map((item) => (
                      <li key={item} className="flex gap-2.5">
                        <span
                          className="mt-2.5 size-1.5 shrink-0 rounded-full bg-[var(--accent)]"
                          aria-hidden="true"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      {phoneActions}
    </div>
  );

  // ---- The page ----------------------------------------------------------------

  return (
    <div className="lg:flex lg:gap-4 lg:p-4">
      {/* SIDEBAR — wide screens only. Collapses to an icon rail. */}
      <aside
        className={`sticky top-4 hidden h-[calc(100vh-2rem)] shrink-0 flex-col rounded-3xl border border-[#26262b] bg-[#111114] p-3 transition-[width] duration-300 motion-reduce:transition-none lg:flex ${
          collapsed ? "w-[84px]" : "w-[280px]"
        }`}
      >
        <div className={`flex items-center gap-3 px-1 pb-4 ${collapsed ? "flex-col" : ""}`}>
          {brandBadge}
          {!collapsed && <span className="min-w-0 flex-1 text-lg font-semibold leading-tight">{t.title}</span>}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? t.expand : t.collapse}
            title={collapsed ? t.expand : t.collapse}
            className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-[#8f8f98] hover:bg-[#1c1c20] hover:text-[#ededed] ${FOCUS}`}
          >
            <Icon name="panel" size={20} className="rtl:-scale-x-100" />
          </button>
        </div>

        <nav aria-label={t.tabs} className="flex flex-col gap-1.5 border-t border-[#1f1f24] pt-4">
          {VIEWS.map((v) => {
            const active = view === v;
            return (
              <button
                key={v}
                type="button"
                aria-current={active ? "page" : undefined}
                title={t.nav[v]}
                onClick={() => chooseView(v)}
                className={`relative flex min-h-12 items-center gap-3 overflow-hidden rounded-2xl px-3.5 text-start text-base transition-colors ${FOCUS} ${
                  collapsed ? "justify-center" : ""
                } ${
                  active
                    ? "border border-[#2e2e35] bg-[#1a1a1f] font-medium text-white"
                    : "border border-transparent text-[#9a9aa3] hover:bg-[#17171b] hover:text-[#ededed]"
                }`}
              >
                {active && (
                  <>
                    <span
                      aria-hidden="true"
                      className="absolute inset-0"
                      style={{
                        background: `linear-gradient(${glow}, transparent 25%, color-mix(in srgb, var(--accent) 30%, transparent) 100%)`,
                      }}
                    />
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-2.5 end-0 w-1 rounded-full bg-[var(--accent)] shadow-[0_0_14px_2px_var(--accent)]"
                    />
                  </>
                )}
                <Icon name={VIEW_ICON[v]} size={21} className="relative" />
                {!collapsed && <span className="relative truncate">{t.nav[v]}</span>}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3 pt-4">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              {tryLink(true)}
              {changeLink(true)}
            </div>
          ) : (
            <div className="rounded-3xl border border-[#26262b] bg-gradient-to-b from-[#18181c] to-[#131316] p-4">
              <div className="flex items-center gap-2 text-lg font-semibold">
                <Icon name="sparkle" size={18} className="text-[var(--accent)]" />
                {t.cardTitle}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-[#8f8f98]">{t.cardText}</p>
              <div className="mt-4 flex flex-col gap-2.5">
                {tryLink(false)}
                {changeLink(false)}
              </div>
            </div>
          )}

          <div
            className={`flex items-center gap-3 rounded-2xl border border-[#26262b] bg-[#141417] p-2.5 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#26262b] text-base font-semibold uppercase">
              {siteName.slice(0, 1)}
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium">{siteName}</span>
                <span className="block text-sm text-[#8f8f98]">{t.numbersAt(updatedAt)}</span>
              </span>
            )}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1 pb-28 lg:pb-6">
        {/* PHONE HEADER */}
        <header className="flex items-center gap-3 px-4 pb-1 pt-5 lg:hidden">
          {brandBadge}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold leading-tight">{t.title}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-[#9a9aa3]">
              {livePill}
              <span>{monthName}</span>
            </p>
          </div>
          {refreshButton}
        </header>

        {/* WIDE-SCREEN TOP BAR */}
        <div className="hidden items-center justify-between gap-4 px-1 pb-6 pt-2 lg:flex">
          <div>
            <h1 className="text-3xl font-semibold leading-tight">{viewTitle}</h1>
            <p className="mt-1 flex items-center gap-4 text-base text-[#9a9aa3]">
              {livePill}
              <span>{monthName}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {usesRange && periodSwitch}
            {refreshButton}
          </div>
        </div>

        {/* PHONE PERIOD SWITCH — sticky, because it drives the view below it. */}
        {usesRange && (
          <div className="sticky top-0 z-20 bg-[#0d0d0f]/85 px-4 py-2.5 backdrop-blur-md lg:hidden">
            {periodSwitch}
          </div>
        )}

        <main className="flex flex-col gap-4 px-4 pt-2 lg:px-0 lg:pt-0">
          <h2 className="px-1 text-xl font-semibold lg:hidden">{viewTitle}</h2>
          {view === "overview" && overview}
          {view === "journey" && journey}
          {view === "activity" && activity}
          {view === "content" && content}
        </main>
      </div>

      {/* PHONE TAB BAR */}
      <nav
        aria-label={t.tabs}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-[#26262b] bg-[#0d0d0f]/90 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md lg:hidden"
      >
        {VIEWS.map((v) => {
          const active = view === v;
          return (
            <button
              key={v}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => chooseView(v)}
              className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-sm ${FOCUS} ${
                active ? "text-white" : "text-[#8f8f98]"
              }`}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-[var(--accent)] shadow-[0_0_10px_2px_var(--accent)]"
                />
              )}
              <Icon name={VIEW_ICON[v]} size={22} className={active ? "text-[var(--accent)]" : ""} />
              <span className="max-w-full truncate px-1">{t.nav[v]}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
