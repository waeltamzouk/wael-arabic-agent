"use client";

// The report page: waits for the audit (polling /api/audit/<id>), then shows it.
//
// Imports TYPES from lib/audit/types, WORDS from lib/audit/copy-ar and drawing pieces from
// ./parts, and nothing else from lib/audit: the crawler and scorer use Node modules (dns,
// http) that must never be bundled into the browser.
//
// The look is Wael's house style (the `wael-style` skill, redone Oct 9): graphite cards in the
// same three-column grid as the client dashboard, ONE accent that means "needs attention" or
// "press this", a ring and bars of ticks, numbered problem tiles. Nothing here changes what the
// audit says, only how it is laid out.

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CATEGORIES, FAILURES, FINDINGS, FORM, GRADES, OBSERVATIONS, parts, REPORT, UNVERIFIED } from "@/lib/audit/copy-ar";
import type { AuditReport, Finding } from "@/lib/audit/types";
import { AddressChip, CARD, OK_FROM, points, ScoreRing, TickBar } from "./parts";

type Api = { status: "running" | "done" | "failed"; domain: string; report: AuditReport | null; failure: string | null };
type View =
  | { kind: "waiting"; domain?: string }
  | { kind: "done"; domain: string; report: AuditReport }
  | { kind: "failed"; domain?: string; failure: string }
  | { kind: "missing" };

const POLL_MS = 1500;
const GIVE_UP_MS = 100_000; // the server marks a lost job as failed at 90 s; this is the backstop

const H2 = "text-xl font-semibold text-white sm:text-2xl";
const TINT = "color-mix(in srgb, var(--accent) 15%, transparent)";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
// The one thing to press. White focus ring: an orange ring around an orange button cannot be seen.
const PRIMARY =
  "flex h-14 items-center justify-center rounded-full bg-accent px-8 text-base font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const OUTLINE = `inline-flex h-11 items-center justify-center rounded-full border border-[#2e2e35] bg-[#1a1a1f] px-5 text-[15px] font-medium text-white transition-colors hover:bg-[#222228] ${FOCUS}`;
const CHEVRON = "size-4 shrink-0 fill-none stroke-current transition-transform group-open:rotate-180";
const SUMMARY = "flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-lg font-semibold text-white [&::-webkit-details-marker]:hidden";

function Shell({ children, narrow = false, tight = false }: { children: ReactNode; narrow?: boolean; tight?: boolean }) {
  return (
    <main className="flex-1 px-4 pb-10 pt-10 sm:px-6 sm:pt-14">
      <div className={`audit-rise mx-auto flex w-full flex-col ${tight ? "gap-4" : "gap-10"} ${narrow ? "max-w-2xl" : "max-w-6xl"}`}>{children}</div>
    </main>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={CHEVRON} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3.5 6 4.5 4.5L12.5 6" />
    </svg>
  );
}

/**
 * Text with `code` spans. Each code span is an inline-block with dir="ltr", which isolates it from
 * the Arabic around it. Without that the bidi algorithm reorders a snippet like
 * <meta name="viewport"> and splits it around the Arabic words.
 */
function Rich({ text }: { text: string }) {
  const ps = parts(text).map((p) => ({ ...p }));
  // Punctuation stuck to a SHORT code chip, like the brackets in «(`viewport`)», is kept on the
  // chip's line: without this the closing bracket wraps alone onto the next line. A long chip
  // is left alone, because a no-break group wider than the line would push the page sideways.
  const glue = new Map<number, { pre: string; post: string }>();
  ps.forEach((p, i) => {
    if (!p.code || p.text.length > 24) return;
    const prev = ps[i - 1];
    const next = ps[i + 1];
    let pre = "";
    let post = "";
    if (prev && !prev.code) {
      pre = prev.text.match(/(\S+)$/)?.[1] ?? "";
      prev.text = prev.text.slice(0, prev.text.length - pre.length);
    }
    if (next && !next.code) {
      post = next.text.match(/^(\S+)/)?.[1] ?? "";
      next.text = next.text.slice(post.length);
    }
    glue.set(i, { pre, post });
  });
  return (
    <>
      {ps.map((p, i) => {
        if (!p.code) return <span key={i}>{p.text}</span>;
        const chip = (
          <code
            dir="ltr"
            className="mx-0.5 inline-block max-w-full break-words rounded-md bg-white/10 px-1.5 py-0.5 align-baseline font-mono text-sm leading-6 text-soft"
          >
            {p.text}
          </code>
        );
        const g = glue.get(i);
        return g ? (
          <span key={i} className="whitespace-nowrap">
            {g.pre}
            {chip}
            {g.post}
          </span>
        ) : (
          <span key={i}>{chip}</span>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- waiting

function Elapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <span aria-hidden="true" className="flex items-center gap-2 text-sm text-faint">
      {REPORT.elapsed}
      <span dir="ltr" className="font-mono tabular-nums text-mute">
        {mm}:{ss}
      </span>
    </span>
  );
}

function Waiting({ domain }: { domain?: string }) {
  return (
    <Shell narrow>
      <header className="flex flex-col gap-5" aria-live="polite">
        <p className="text-sm text-mute">{REPORT.reportOf}</p>
        <h1 className="text-4xl font-bold leading-tight text-white sm:text-5xl">{REPORT.progressTitle}</h1>
        {/* The address bar again, now with a light moving along it while the audit runs. */}
        <div className="flex flex-col gap-3">
          {domain ? <AddressChip domain={domain} /> : <div className="h-10 w-56 rounded-full bg-raised" />}
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
            <div className="audit-sweep absolute inset-y-0 start-0 w-2/5 rounded-full bg-accent" />
          </div>
        </div>
      </header>

      <ul className={`${CARD} flex flex-col gap-4`}>
        {REPORT.progressSteps.map((step, i) => (
          <li key={step} className="flex items-center gap-3.5 text-[17px] text-soft">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-accent motion-safe:animate-pulse"
              style={{ animationDelay: `${i * 250}ms` }}
            />
            {step}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3">
        <p className="text-[15px] leading-8 text-mute">{REPORT.progressNote}</p>
        <Elapsed />
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- pieces of the report

function FindingCard({ finding, rank }: { finding: Finding; rank?: number }) {
  const copy = FINDINGS[finding.id];
  if (!copy) return null;
  const evidence = copy.evidence?.(finding.params);
  // How much it cost is the one number here that is pure data: the points this finding took off.
  // The big ones carry the accent; the small ones stay grey so the eye goes to what matters.
  const big = finding.lost >= 4;
  return (
    <article className={CARD}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <h3 className="flex min-w-0 items-start gap-3.5 text-xl font-semibold leading-snug text-white sm:flex-1">
          {rank && (
            <span dir="ltr" aria-hidden="true" className="mt-1 shrink-0 font-mono text-base text-faint">
              {String(rank).padStart(2, "0")}
            </span>
          )}
          <span className="min-w-0">
            <Rich text={copy.title} />
          </span>
        </h3>
        {finding.lost > 0 && (
          <span
            className={`w-fit shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${big ? "text-accent" : "bg-white/10 text-mute"}`}
            style={big ? { background: TINT } : undefined}
          >
            {REPORT.costs(points(finding.lost))}
          </span>
        )}
      </header>

      {evidence && (
        <p className="mt-5 rounded-2xl bg-lift px-4 py-3 text-[15px] leading-8 text-mute">
          <span className="font-medium text-soft">{REPORT.evidence}: </span>
          <Rich text={evidence} />
        </p>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-2 md:gap-8">
        <div>
          <h4 className="text-sm font-medium text-faint">{REPORT.why}</h4>
          <p className="mt-2 text-base leading-8 text-mute">
            <Rich text={copy.why} />
          </p>
        </div>
        <div className="border-accent md:border-s-2 md:ps-6">
          <h4 className="text-sm font-medium text-accent">{REPORT.fix}</h4>
          <p className="mt-2 text-base leading-8 text-white">
            <Rich text={copy.fix} />
          </p>
        </div>
      </div>
    </article>
  );
}

/** Pass or fail in the page table: a light tick when fine, the accent cross when not. */
function Mark({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-flex ${ok ? "text-[#d4d4d8]" : "text-accent"}`}>
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {ok ? <path d="m3.5 8.5 3 3 6-7" /> : <path d="m4 4 8 8M12 4l-8 8" />}
      </svg>
      <span className="sr-only">{ok ? REPORT.yes : REPORT.no}</span>
    </span>
  );
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}

function Report({ domain, report, whatsapp }: { domain: string; report: AuditReport; whatsapp: string | null }) {
  const grade = report.grade;
  const score = report.score;
  const top = report.top.map((id) => report.findings.find((f) => f.id === id)).filter((f): f is Finding => Boolean(f));
  const rest = report.findings.filter((f) => !report.top.includes(f.id));
  const message =
    `السلام عليكم وائل، فحصت موقعي ${domain}` + (score !== null ? ` وحصل على ${score} من 100` : "") + "، وأحب أناقش التقرير.";
  const ctaHref = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}` : "https://waelwebdesign.com/contact";
  const notChecked = report.unverified.filter((id) => id !== "js_shell");

  // The weakest part, for the one-sentence summary. Parts we could not verify are left out.
  const rated = report.categories.filter((c): c is typeof c & { score: number } => c.score !== null);
  const weakest = rated.length ? rated.reduce((a, b) => (a.score / a.max <= b.score / b.max ? a : b)) : null;
  const allStrong = weakest !== null && (weakest.score / weakest.max) * 100 >= 85;
  const [pre, mid, of] = allStrong ? REPORT.insightStrong : REPORT.insightWeak;

  const kpis: { label: string; value: string; unit?: string }[] = [
    { label: REPORT.kpi.findings, value: String(report.findings.length) },
    { label: REPORT.kpi.pages, value: String(report.pages.length) },
    { label: REPORT.kpi.weight, value: report.approxWeightMb === null ? "—" : String(report.approxWeightMb), unit: report.approxWeightMb === null ? undefined : "MB" },
    { label: REPORT.kpi.requests, value: report.requestsEstimated === null ? "—" : String(report.requestsEstimated) },
  ];

  return (
    <Shell tight>
      <h1 className="sr-only">{REPORT.pageTitle(domain)}</h1>

      <header className="flex flex-wrap items-end justify-between gap-4 pb-4">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-sm text-mute">{REPORT.reportOf}</p>
          <AddressChip domain={domain} />
        </div>
        {/* The same WhatsApp link as the card at the end, so it is in reach without scrolling. */}
        <a href={ctaHref} target="_blank" rel="noopener noreferrer" className={OUTLINE}>
          {REPORT.ctaButton}
        </a>
      </header>

      {/* ---- the score, and the five parts it is made of */}
      {score !== null && grade && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className={`${CARD} flex flex-col items-center justify-center gap-6 text-center`}>
              <ScoreRing score={score} />
              {/* -mt-10: the ring is open at the bottom, so the label can sit up in the gap. */}
              <div className="-mt-10 flex flex-col items-center gap-1.5">
                <p className="text-sm text-faint">{REPORT.scoreLabel}</p>
                <p className="flex items-center gap-2.5 text-2xl font-semibold text-white">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full"
                    style={{ background: score >= OK_FROM ? "#d4d4d8" : "var(--accent)" }}
                  />
                  {GRADES[grade].label}
                </p>
                <p className="max-w-[18rem] text-[15px] leading-7 text-mute">{GRADES[grade].line}</p>
              </div>
            </section>

            <section className={`${CARD} lg:col-span-2`}>
              <h2 className="text-lg font-semibold text-white">{REPORT.categories}</h2>
              {weakest && (
                <p className="mt-3 text-xl leading-9 text-faint sm:text-2xl sm:leading-10">
                  {pre}
                  <span className="font-semibold text-white">{CATEGORIES[weakest.id].name}</span>
                  {mid}
                  <bdi>{weakest.score}</bdi>
                  {of}
                  <bdi>{weakest.max}</bdi>.
                </p>
              )}
              <ul className="mt-7 flex flex-col gap-6">
                {report.categories.map((c) => {
                  const percent = c.score === null ? 0 : Math.round((c.score / c.max) * 100);
                  return (
                    <li key={c.id} className="flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-base font-medium text-white">{CATEGORIES[c.id].name}</p>
                          <p className="hidden text-sm text-faint sm:block">{CATEGORIES[c.id].about}</p>
                        </div>
                        <span dir="ltr" className="shrink-0 text-lg font-semibold tabular-nums text-white">
                          {c.score === null ? "—" : c.score}
                          <span className="text-sm font-normal text-faint">/{c.max}</span>
                        </span>
                      </div>
                      <TickBar percent={percent} height={22} />
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          <section className={`${CARD} grid grid-cols-2 gap-x-6 gap-y-7 lg:grid-cols-4`}>
            {kpis.map((k) => (
              <div key={k.label}>
                <p className="text-sm text-faint">{k.label}</p>
                <p className="mt-2 text-4xl font-semibold leading-none tabular-nums text-white">
                  <bdi dir="ltr">
                    {k.value}
                    {k.unit && <span className="ms-1.5 text-base font-normal text-faint">{k.unit}</span>}
                  </bdi>
                </p>
              </div>
            ))}
          </section>
        </>
      )}

      {/* ---- the problems on the wide side; the next step and the small print beside them */}
      <div className="grid grid-cols-1 items-start gap-4 pt-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {score !== null && grade ? (
            <>
              <section aria-labelledby="top" className="flex flex-col gap-4">
                <div className="px-1">
                  <h2 id="top" className={H2}>
                    {REPORT.top3}
                  </h2>
                  <p className="mt-1.5 text-sm text-faint">{REPORT.top3Lead}</p>
                </div>
                {top.length ? top.map((f, i) => <FindingCard key={f.id} finding={f} rank={i + 1} />) : <p className={`${CARD} text-mute`}>{REPORT.nothingToFix}</p>}
              </section>

              {rest.length > 0 && (
                <details className={`${CARD} group`}>
                  <summary className={SUMMARY}>
                    <span>
                      {REPORT.allFindings} <span className="text-faint">({rest.length})</span>
                    </span>
                    <Chevron />
                  </summary>
                  <div className="mt-6 flex flex-col gap-4">
                    {rest.map((f) => (
                      <FindingCard key={f.id} finding={f} />
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : (
            <section className={CARD}>
              <h2 className="text-2xl font-semibold text-white">{REPORT.noScoreTitle}</h2>
              <p className="mt-3 text-base leading-8 text-mute">{UNVERIFIED.js_shell}</p>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {/* The next step. The one glow on the page, and the one orange button. The glow sits at
              the top so the button, at the bottom, is not drawn on top of its own colour. */}
          <section className="relative overflow-hidden rounded-3xl border border-line bg-card-2 p-6">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-3/5"
              style={{ background: "radial-gradient(80% 100% at 50% 0%, color-mix(in srgb, var(--accent) 30%, transparent), transparent)" }}
            />
            <div className="relative flex flex-col gap-4">
              <h2 className="text-2xl font-semibold leading-snug text-white">{REPORT.ctaTitle}</h2>
              <p className="text-base leading-8 text-[#c9c9d0]">{REPORT.ctaText}</p>
              <a href={ctaHref} target="_blank" rel="noopener noreferrer" className={`${PRIMARY} mt-2 w-full`}>
                {REPORT.ctaButton}
              </a>
            </div>
          </section>

          {report.observations.map((o) => {
            const copy = OBSERVATIONS[o.id];
            return copy ? (
              <aside key={o.id} className="rounded-3xl border border-dashed border-[#2e2e35] p-5 sm:p-6">
                <p className="text-base font-semibold text-white">{copy.title(o.params)}</p>
                <p className="mt-2 text-[15px] leading-8 text-mute">{copy.text}</p>
              </aside>
            ) : null;
          })}

          {notChecked.length > 0 && (
            <section className={CARD}>
              <h2 className="text-base font-semibold text-white">{REPORT.notChecked}</h2>
              <ul className="mt-3 flex flex-col gap-2.5 text-[15px] leading-7 text-mute">
                {notChecked.map((id) => (
                  <li key={id} className="flex items-start gap-3">
                    <span aria-hidden="true" className="mt-3 size-1.5 shrink-0 rounded-full bg-[#4b4b55]" />
                    <span>{UNVERIFIED[id] ?? id}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <details className={`${CARD} group`}>
            <summary className={SUMMARY}>
              {REPORT.methodTitle}
              <Chevron />
            </summary>
            <p className="mt-4 text-[15px] leading-8 text-mute">{REPORT.methodChecked}</p>
            <p className="mt-3 text-[15px] leading-8 text-mute">{REPORT.methodLimits}</p>
          </details>
        </div>
      </div>

      {/* ---- the pages that were read */}
      <section aria-labelledby="pages" className="flex flex-col gap-4 pt-4">
        <h2 id="pages" className={`${H2} px-1`}>
          {REPORT.pages}
        </h2>
        {/* `relative` is NOT decoration. The check marks carry an sr-only label, which is
            position:absolute. Without a positioned ancestor it is placed against the PAGE, not
            this scroll box, so it escapes the clipping and widens the whole page on a phone. */}
        <div className="relative overflow-x-auto rounded-3xl border border-line bg-gradient-to-b from-card-1 to-card-2">
          {/* On a phone the two technical columns (lang, dir) are left out: the findings already
              cover them, and without them the useful columns fit with no sideways scroll. */}
          <table className="w-full text-sm sm:min-w-[36rem]">
            <thead>
              <tr className="text-faint">
                <th scope="col" className="px-5 py-4 text-start font-medium">{REPORT.pageCols.page}</th>
                <th scope="col" className="px-2 py-4 text-start font-medium">{REPORT.pageCols.arabic}</th>
                <th scope="col" className="hidden px-2 py-4 text-start font-medium sm:table-cell">{REPORT.pageCols.lang}</th>
                <th scope="col" className="hidden px-2 py-4 text-start font-medium sm:table-cell">{REPORT.pageCols.dir}</th>
                <th scope="col" className="px-2 py-4 text-start font-medium">{REPORT.pageCols.viewport}</th>
                <th scope="col" className="px-2 py-4 text-start font-medium">{REPORT.pageCols.contact}</th>
                <th scope="col" className="px-5 py-4 text-start font-medium">{REPORT.pageCols.size}</th>
              </tr>
            </thead>
            <tbody className="text-soft">
              {report.pages.map((p) => (
                <tr key={p.url} className="border-t border-line">
                  <td className="px-5 py-3.5">
                    <bdi dir="ltr" className="break-all font-mono text-sm">{pathOf(p.url)}</bdi>
                  </td>
                  <td className="px-2 py-3.5"><bdi dir="ltr">{p.arabicShare}%</bdi></td>
                  <td className="hidden px-2 py-3.5 sm:table-cell"><Mark ok={p.langOk} /></td>
                  <td className="hidden px-2 py-3.5 sm:table-cell"><Mark ok={p.dirOk} /></td>
                  <td className="px-2 py-3.5"><Mark ok={p.viewportOk} /></td>
                  <td className="px-2 py-3.5"><Mark ok={p.hasDirectContact} /></td>
                  <td className="px-5 py-3.5"><bdi dir="ltr">{p.kb} KB</bdi></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="pt-6 text-center">
        <Link href="/audit" className={`inline-flex min-h-11 items-center rounded-full px-3 text-[15px] text-mute underline underline-offset-4 transition-colors hover:text-white ${FOCUS}`}>
          {REPORT.backToForm}
        </Link>
      </p>
    </Shell>
  );
}

// ---------------------------------------------------------------- the page

export default function ReportView({ id, whatsapp }: { id: string; whatsapp: string | null }) {
  const [view, setView] = useState<View>({ kind: "waiting" });

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    async function tick() {
      try {
        const res = await fetch(`/api/audit/${id}`, { cache: "no-store" });
        if (stopped) return;
        if (res.status === 404) return setView({ kind: "missing" });
        if (res.ok) {
          const data = (await res.json()) as Api;
          if (stopped) return;
          if (data.status === "done" && data.report) return setView({ kind: "done", domain: data.domain, report: data.report });
          if (data.status === "failed") return setView({ kind: "failed", domain: data.domain, failure: data.failure ?? "error" });
          setView({ kind: "waiting", domain: data.domain });
        }
      } catch {
        /* a dropped request is not a failed audit: try again */
      }
      if (Date.now() - started > GIVE_UP_MS) return setView({ kind: "failed", failure: "stale" });
      timer = setTimeout(tick, POLL_MS);
    }

    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (view.kind === "waiting") return <Waiting domain={view.domain} />;
  if (view.kind === "done") return <Report domain={view.domain} report={view.report} whatsapp={whatsapp} />;

  return (
    <Shell narrow>
      <section className={`${CARD} flex flex-col gap-5`}>
        {view.kind === "failed" && view.domain && <AddressChip domain={view.domain} />}
        <h1 className="text-2xl font-semibold leading-snug text-white sm:text-3xl">
          {view.kind === "missing" ? FORM.notFound : (FAILURES[view.failure] ?? FAILURES.error)}
        </h1>
        <Link href="/audit" className={PRIMARY}>
          {view.kind === "failed" ? REPORT.retry : REPORT.backToForm}
        </Link>
      </section>
    </Shell>
  );
}
