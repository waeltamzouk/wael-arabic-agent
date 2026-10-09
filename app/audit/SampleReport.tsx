// A small, static picture of what the report looks like, on the landing page. The deliverable
// is the strongest argument for typing an address, so it is shown, not described.
//
// IT IS NOT A REAL SITE and says so, in the caption below the card. The card itself is
// aria-hidden: screen readers get the caption, not made-up numbers.
// No hooks or browser APIs: it renders on the server. Same pieces and same look as the real
// report (graphite card, tick ring, tick bars), only smaller.

import { CATEGORIES, FINDINGS, GRADES, LANDING, REPORT } from "@/lib/audit/copy-ar";
import { AddressChip, CARD, OK_FROM, points, ScoreRing, TickBar } from "./parts";

// Chosen so the categories add up to the total, the way a real report's do (24+14+6+11+7 = 62).
const SAMPLE = {
  domain: "example.com.sa",
  score: 62,
  grade: "needs_work",
  categories: [
    { id: "arabic", score: 24, max: 30 },
    { id: "mobile", score: 14, max: 20 },
    { id: "contact", score: 6, max: 20 },
    { id: "speed", score: 11, max: 15 },
    { id: "trust", score: 7, max: 15 },
  ],
  finding: { id: "con_no_direct", lost: 8 },
} as const;

export default function SampleReport() {
  const finding = FINDINGS[SAMPLE.finding.id];
  return (
    <figure className="flex flex-col gap-4">
      <div aria-hidden="true" className={CARD}>
        <AddressChip domain={SAMPLE.domain} />

        <div className="mt-6 flex items-center gap-5 sm:gap-7">
          <ScoreRing score={SAMPLE.score} size="size-32 shrink-0 sm:size-36" />
          <div className="flex flex-col gap-1">
            <span className="text-sm text-faint">{REPORT.scoreLabel}</span>
            <span className="flex items-center gap-2 text-xl font-semibold text-white">
              <span
                className="size-2.5 rounded-full"
                style={{ background: SAMPLE.score >= OK_FROM ? "#d4d4d8" : "var(--accent)" }}
              />
              {GRADES[SAMPLE.grade].label}
            </span>
          </div>
        </div>

        <ul className="mt-6 flex flex-col gap-4">
          {SAMPLE.categories.map((c) => {
            const percent = Math.round((c.score / c.max) * 100);
            return (
              <li key={c.id} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-soft">{CATEGORIES[c.id].name}</span>
                  <span dir="ltr" className="tabular-nums text-mute">{c.score}/{c.max}</span>
                </div>
                <TickBar percent={percent} height={14} />
              </li>
            );
          })}
        </ul>

        <div className="mt-6 rounded-2xl bg-lift p-4">
          <span
            className="inline-block rounded-full px-3 py-1 text-sm font-medium text-accent"
            style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)" }}
          >
            {REPORT.costs(points(SAMPLE.finding.lost))}
          </span>
          <p className="mt-2.5 text-[15px] font-semibold leading-7 text-white">{finding.title}</p>
          <p className="mt-1 line-clamp-2 text-sm leading-7 text-mute">{finding.why}</p>
        </div>
      </div>

      <figcaption className="text-sm leading-7 text-faint">
        <span className="font-medium text-mute">{LANDING.sampleTitle}. </span>
        {LANDING.sampleNote}
      </figcaption>
    </figure>
  );
}
