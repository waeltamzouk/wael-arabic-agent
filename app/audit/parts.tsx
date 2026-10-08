// Small pieces shared by the landing page, the sample report and the real report.
// No hooks and no browser APIs, so they work in server and client components alike.

import type { ReactNode } from "react";

/** Grade -> the colour it is shown in. Bright tones: these sit on pure black. */
export const TONE: Record<string, { text: string; bar: string; chip: string }> = {
  excellent: { text: "text-emerald-400", bar: "bg-emerald-400", chip: "bg-emerald-400/10 text-emerald-300" },
  good: { text: "text-lime-400", bar: "bg-lime-400", chip: "bg-lime-400/10 text-lime-300" },
  needs_work: { text: "text-amber-400", bar: "bg-amber-400", chip: "bg-amber-400/10 text-amber-300" },
  weak: { text: "text-red-400", bar: "bg-red-400", chip: "bg-red-400/10 text-red-300" },
};

/** The same bands as lib/audit/score.ts gradeOf, kept here so the browser never imports the scorer. */
export function band(percent: number): string {
  return percent >= 85 ? "excellent" : percent >= 70 ? "good" : percent >= 50 ? "needs_work" : "weak";
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
 * The score as a ring. It draws itself once on arrival (see `.audit-ring` in globals.css);
 * with reduced motion it simply appears. `size` is the CSS size class, e.g. "size-44".
 */
export function ScoreRing({ score, grade, size = "size-44" }: { score: number; grade: string; size?: string }) {
  const r = 52;
  const full = 2 * Math.PI * r;
  const to = full * (1 - score / 100);
  return (
    <div className={`relative shrink-0 ${size} ${TONE[grade].text}`} role="img" aria-label={`الدرجة ${score} من 100`}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="9" className="stroke-white/10" />
        <circle
          cx="60" cy="60" r={r} fill="none" strokeWidth="9" strokeLinecap="round" stroke="currentColor"
          className="audit-ring"
          strokeDasharray={full}
          strokeDashoffset={to}
          style={{ "--ring-full": full, "--ring-to": to } as React.CSSProperties}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span dir="ltr" className="text-5xl font-bold leading-none text-white">{score}</span>
        <span className="mt-1 text-xs text-mute">من 100</span>
      </div>
    </div>
  );
}

/** A thin horizontal bar. Fills from the reading start (the right, in Arabic). */
export function Bar({ percent, grade }: { percent: number; grade: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
      <div className={`h-full rounded-full ${TONE[grade].bar}`} style={{ width: `${Math.max(percent, 2)}%` }} />
    </div>
  );
}
