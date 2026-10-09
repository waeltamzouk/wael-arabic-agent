// Small pieces shared by the landing page's sample report and the real report.
// No hooks and no browser APIs, so they work in server and client components alike.
//
// The look is Wael's house style (the `wael-style` skill): graphite cards, ONE accent, a ring
// and bars made of ticks. The accent means "this needs attention" (and, elsewhere, "press
// this"); anything that is fine stays light grey. Green and red are not used at all here.

import { useId, type CSSProperties, type ReactNode } from "react";

/** From this share of the points up a part of the site counts as fine: the same cut as "جيد" in score.ts. */
export const OK_FROM = 70;

const TICK_ON = "#d4d4d8";
const TICK_OFF = "#2c2c32";

/** The report card: graphite, hairline border, 24px corners (tokens live in globals.css). */
export const CARD = "rounded-3xl border border-line bg-gradient-to-b from-card-1 to-card-2 p-5 sm:p-6";

/** Light grey when fine, the accent when it needs attention. */
function tickColor(percent: number): string {
  return percent >= OK_FROM ? TICK_ON : "var(--accent)";
}

/** How many of `count` ticks are lit. A score above zero always lights at least one. */
function lit(percent: number, count: number): number {
  return percent <= 0 ? 0 : Math.min(count, Math.max(1, Math.round((percent / 100) * count)));
}

/** "نقطة" with the right Arabic number form: 1 نقطة واحدة, 2 نقطتان, 3-10 نقاط, 11+ نقطة. */
export function points(n: number): string {
  if (n === 1) return "نقطة واحدة";
  if (n === 2) return "نقطتان";
  return n >= 3 && n <= 10 ? `${n} نقاط` : `${n} نقطة`;
}

function Lock() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

/**
 * The site's address, drawn as the address bar of a browser. It is the motif of the whole
 * flow: the thing a visitor types, the thing the audit measures, and the heading of the report.
 */
export function AddressChip({ domain, children }: { domain: string; children?: ReactNode }) {
  return (
    <div dir="ltr" className="inline-flex max-w-full items-center gap-2.5 rounded-full bg-raised py-2 pe-5 ps-4 text-mute ring-1 ring-hair">
      <Lock />
      <span className="truncate font-mono text-sm text-soft sm:text-[15px]">{domain}</span>
      {children}
    </div>
  );
}

/**
 * The score as a ring of 64 small ticks on a 270 degree arc, lit one after another on arrival
 * (CSS only, see `.audit-tick`; off for reduced motion). Mirrored, because the page is Arabic:
 * it fills from the right. `size` is the CSS size, e.g. "w-full max-w-[260px]".
 */
export function ScoreRing({ score, size = "w-full max-w-[260px]" }: { score: number; size?: string }) {
  const N = 64;
  const filled = lit(score, N);
  const on = tickColor(score);
  return (
    <div className={`relative aspect-square ${size}`} role="img" aria-label={`الدرجة ${score} من 100`}>
      <svg viewBox="0 0 240 240" className="absolute inset-0 size-full -scale-x-100" aria-hidden="true">
        {Array.from({ length: N }, (_, i) => {
          const a = ((135 + (i * 270) / (N - 1)) * Math.PI) / 180;
          const [c, s] = [Math.cos(a), Math.sin(a)];
          // Rounded: the server and the browser print the last float digits differently,
          // and a mismatch is a hydration error.
          const at = (r: number, v: number) => Math.round((120 + v * r) * 100) / 100;
          const isOn = i < filled;
          return (
            <line
              key={i}
              x1={at(90, c)}
              y1={at(90, s)}
              x2={at(108, c)}
              y2={at(108, s)}
              strokeWidth="4.5"
              strokeLinecap="round"
              className={isOn ? "audit-tick" : undefined}
              style={{ stroke: isOn ? on : TICK_OFF, "--d": `${i * 10}ms` } as CSSProperties}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span dir="ltr" className="text-6xl font-bold leading-none tabular-nums text-white">{score}</span>
        <span className="mt-2 text-base text-faint">من 100</span>
      </div>
    </div>
  );
}

/**
 * A bar made of thin ticks, filled from the reading start (the right, in Arabic). The ticks are
 * an SVG pattern with a fixed pitch, so they stay thin at any width: a fixed count of ticks
 * turns into fat beads in a wide card. The lit part grows in (CSS only, `.audit-fill`; off for
 * reduced motion). Both layers are mirrored so their ticks line up from the right edge.
 */
export function TickBar({ percent, height = 20 }: { percent: number; height?: number }) {
  // useId gives ids like ":r1:" or "_r_1_"; keep only what is safe inside url(#...).
  const base = `tb${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const share = percent <= 0 ? 0 : Math.min(100, Math.max(percent, 2));
  const layer = (suffix: string) => (
    <>
      <defs>
        <pattern id={`${base}${suffix}`} width="7" height={height} patternUnits="userSpaceOnUse">
          <rect width="3.5" height={height} rx="1.75" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${base}${suffix})`} />
    </>
  );
  return (
    <div className="relative w-full" style={{ height }} aria-hidden="true">
      <svg className="absolute inset-0 size-full -scale-x-100" style={{ color: TICK_OFF }}>
        {layer("t")}
      </svg>
      {share > 0 && (
        <svg className="audit-fill absolute inset-y-0 start-0 -scale-x-100" style={{ color: tickColor(percent), width: `${share}%`, height: "100%" }}>
          {layer("f")}
        </svg>
      )}
    </div>
  );
}
