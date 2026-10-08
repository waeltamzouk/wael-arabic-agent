"use client";

// The report page: waits for the audit (polling /api/audit/<id>), then shows it.
//
// Imports TYPES from lib/audit/types, WORDS from lib/audit/copy-ar and drawing pieces from
// ./parts, and nothing else from lib/audit: the crawler and scorer use Node modules (dns,
// http) that must never be bundled into the browser.

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CATEGORIES, FAILURES, FINDINGS, FORM, GRADES, OBSERVATIONS, parts, REPORT, UNVERIFIED } from "@/lib/audit/copy-ar";
import type { AuditReport, Finding } from "@/lib/audit/types";
import { AddressChip, Bar, band, points, ScoreRing, TONE } from "./parts";

type Api = { status: "running" | "done" | "failed"; domain: string; report: AuditReport | null; failure: string | null };
type View =
  | { kind: "waiting"; domain?: string }
  | { kind: "done"; domain: string; report: AuditReport }
  | { kind: "failed"; domain?: string; failure: string }
  | { kind: "missing" };

const POLL_MS = 1500;
const GIVE_UP_MS = 100_000; // the server marks a lost job as failed at 90 s; this is the backstop

const CARD = "rounded-3xl bg-panel p-5 ring-1 ring-hair sm:p-7";
const H2 = "text-2xl font-bold text-white sm:text-3xl";
const PRIMARY =
  "flex h-14 items-center justify-center rounded-full bg-accent px-8 text-base font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

function Shell({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <main className="flex-1 px-4 pb-10 pt-10 sm:px-6 sm:pt-14">
      <div className={`audit-rise mx-auto flex w-full flex-col gap-10 ${narrow ? "max-w-2xl" : "max-w-4xl"}`}>{children}</div>
    </main>
  );
}

/**
 * Text with `code` spans. Each code span is an inline-block with dir="ltr", which isolates it from
 * the Arabic around it. Without that the bidi algorithm reorders a snippet like
 * <meta name="viewport"> and splits it around the Arabic words.
 */
function Rich({ text }: { text: string }) {
  return (
    <>
      {parts(text).map((p, i) =>
        p.code ? (
          <code
            key={i}
            dir="ltr"
            className="mx-0.5 inline-block max-w-full break-words rounded-md bg-white/10 px-1.5 py-0.5 align-baseline font-mono text-[0.85em] leading-6 text-soft"
          >
            {p.text}
          </code>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
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
  const cost = finding.lost >= 8 ? TONE.weak.chip : finding.lost >= 4 ? TONE.needs_work.chip : "bg-white/10 text-mute";
  return (
    <article className={CARD}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <h3 className="flex min-w-0 items-start gap-3.5 text-xl font-bold leading-snug text-white sm:flex-1 sm:text-2xl">
          {rank && (
            <span aria-hidden="true" className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-base text-black">
              {rank}
            </span>
          )}
          <span className="min-w-0">
            <Rich text={copy.title} />
          </span>
        </h3>
        {finding.lost > 0 && (
          <span className={`w-fit shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${cost}`}>
            {REPORT.costs(points(finding.lost))}
          </span>
        )}
      </header>

      {evidence && (
        <p className="mt-5 rounded-2xl bg-raised px-4 py-3 text-[15px] leading-8 text-mute">
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
          <h4 className="text-sm font-medium text-accent-text">{REPORT.fix}</h4>
          <p className="mt-2 text-base leading-8 text-white">
            <Rich text={copy.fix} />
          </p>
        </div>
      </div>
    </article>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "text-emerald-400" : "text-red-400"}>
      <span aria-hidden="true">{ok ? "✓" : "✗"}</span>
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
  const top = report.top.map((id) => report.findings.find((f) => f.id === id)).filter((f): f is Finding => Boolean(f));
  const rest = report.findings.filter((f) => !report.top.includes(f.id));
  const message =
    `السلام عليكم وائل، فحصت موقعي ${domain}` +
    (report.score !== null ? ` وحصل على ${report.score} من 100` : "") +
    "، وأحب أناقش التقرير.";

  return (
    <Shell>
      <header className="flex flex-col gap-4">
        <p className="text-sm text-mute">{REPORT.reportOf}</p>
        <AddressChip domain={domain} />
      </header>

      {/* ---- the score, and the five parts it is made of */}
      {report.score !== null && grade ? (
        <section className="grid gap-8 rounded-[2rem] bg-panel p-6 ring-1 ring-hair sm:p-9 md:grid-cols-[auto_1fr] md:items-center md:gap-14">
          <div className="flex flex-col items-center gap-5 text-center md:items-start md:text-start">
            <ScoreRing score={report.score} grade={grade} size="size-44 sm:size-52" />
            <div className="flex flex-col gap-1">
              <p className="text-sm text-mute">{REPORT.scoreLabel}</p>
              <p className={`text-3xl font-bold ${TONE[grade].text}`}>{GRADES[grade].label}</p>
              <p className="max-w-[18rem] text-[15px] leading-8 text-mute">{GRADES[grade].line}</p>
            </div>
          </div>

          <div>
            <h2 className="mb-5 text-sm font-medium text-faint">{REPORT.categories}</h2>
            <ul className="flex flex-col gap-5">
              {report.categories.map((c) => {
                const percent = c.score === null ? 0 : Math.round((c.score / c.max) * 100);
                return (
                  <li key={c.id} className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-white">{CATEGORIES[c.id].name}</span>
                      <span dir="ltr" className="text-sm text-mute">
                        {c.score === null ? "—" : `${c.score}/${c.max}`}
                      </span>
                    </div>
                    <Bar percent={percent} grade={band(percent)} />
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : (
        <section className={CARD}>
          <h2 className="text-2xl font-bold text-white">{REPORT.noScoreTitle}</h2>
          <p className="mt-3 text-base leading-8 text-mute">{UNVERIFIED.js_shell}</p>
        </section>
      )}

      {/* ---- the biggest problems, ranked by what they cost */}
      {report.score !== null && (
        <section aria-labelledby="top" className="flex flex-col gap-5">
          <div>
            <h2 id="top" className={H2}>
              {REPORT.top3}
            </h2>
            <p className="mt-2 text-[15px] text-mute">{REPORT.top3Lead}</p>
          </div>
          {top.length ? top.map((f, i) => <FindingCard key={f.id} finding={f} rank={i + 1} />) : <p className={`${CARD} text-mute`}>{REPORT.nothingToFix}</p>}
        </section>
      )}

      {rest.length > 0 && (
        <details className={`${CARD} group`}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-lg font-bold text-white [&::-webkit-details-marker]:hidden">
            <span>
              {REPORT.allFindings} <span className="text-mute">({rest.length})</span>
            </span>
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0 fill-none stroke-current transition-transform group-open:rotate-180" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3.5 6 4.5 4.5L12.5 6" />
            </svg>
          </summary>
          <div className="mt-6 flex flex-col gap-4">
            {rest.map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </div>
        </details>
      )}

      {report.observations.map((o) => {
        const copy = OBSERVATIONS[o.id];
        return copy ? (
          <aside key={o.id} className="rounded-3xl border border-dashed border-hair-strong p-5 sm:p-7">
            <p className="text-lg font-bold text-white">{copy.title(o.params)}</p>
            <p className="mt-2 text-base leading-8 text-mute">{copy.text}</p>
          </aside>
        ) : null;
      })}

      {/* ---- the pages that were read */}
      <section aria-labelledby="pages" className="flex flex-col gap-4">
        <h2 id="pages" className={H2}>
          {REPORT.pages}
        </h2>
        {/* `relative` is NOT decoration. The check marks carry an sr-only label, which is
            position:absolute. Without a positioned ancestor it is placed against the PAGE, not
            this scroll box, so it escapes the clipping and widens the whole page on a phone. */}
        <div className="relative overflow-x-auto rounded-3xl bg-panel ring-1 ring-hair">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-faint">
                <th scope="col" className="px-5 py-4 text-start font-medium">{REPORT.pageCols.page}</th>
                <th scope="col" className="px-2 py-4 text-start font-medium">{REPORT.pageCols.arabic}</th>
                <th scope="col" className="px-2 py-4 text-start font-medium">{REPORT.pageCols.lang}</th>
                <th scope="col" className="px-2 py-4 text-start font-medium">{REPORT.pageCols.dir}</th>
                <th scope="col" className="px-2 py-4 text-start font-medium">{REPORT.pageCols.viewport}</th>
                <th scope="col" className="px-2 py-4 text-start font-medium">{REPORT.pageCols.contact}</th>
                <th scope="col" className="px-5 py-4 text-start font-medium">{REPORT.pageCols.size}</th>
              </tr>
            </thead>
            <tbody className="text-soft">
              {report.pages.map((p) => (
                <tr key={p.url} className="border-t border-hair">
                  <td className="px-5 py-3.5">
                    <bdi dir="ltr" className="break-all font-mono text-[13px]">{pathOf(p.url)}</bdi>
                  </td>
                  <td className="px-2 py-3.5"><bdi dir="ltr">{p.arabicShare}%</bdi></td>
                  <td className="px-2 py-3.5"><Mark ok={p.langOk} /></td>
                  <td className="px-2 py-3.5"><Mark ok={p.dirOk} /></td>
                  <td className="px-2 py-3.5"><Mark ok={p.viewportOk} /></td>
                  <td className="px-2 py-3.5"><Mark ok={p.hasDirectContact} /></td>
                  <td className="px-5 py-3.5"><bdi dir="ltr">{p.kb} KB</bdi></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- what we could not check, and the method */}
      {report.unverified.filter((id) => id !== "js_shell").length > 0 && (
        <section className={CARD}>
          <h2 className="text-lg font-bold text-white">{REPORT.notChecked}</h2>
          <ul className="mt-3 list-disc ps-5 text-base leading-8 text-mute">
            {report.unverified.filter((id) => id !== "js_shell").map((id) => (
              <li key={id}>{UNVERIFIED[id] ?? id}</li>
            ))}
          </ul>
        </section>
      )}

      <details className={`${CARD} group`}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-lg font-bold text-white [&::-webkit-details-marker]:hidden">
          {REPORT.methodTitle}
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0 fill-none stroke-current transition-transform group-open:rotate-180" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3.5 6 4.5 4.5L12.5 6" />
          </svg>
        </summary>
        <p className="mt-4 text-[15px] leading-8 text-mute">{REPORT.methodChecked}</p>
        <p className="mt-3 text-[15px] leading-8 text-mute">{REPORT.methodLimits}</p>
      </details>

      {/* ---- the next step. White on black, the way waelwebdesign.com ends its sections. */}
      <section className="flex flex-col gap-5 rounded-[2rem] bg-white p-7 text-black sm:p-10">
        <h2 className="text-3xl font-bold leading-snug sm:text-4xl">{REPORT.ctaTitle}</h2>
        <p className="max-w-xl text-lg leading-9 text-zinc-700">{REPORT.ctaText}</p>
        <a
          href={whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}` : "https://waelwebdesign.com/contact"}
          target="_blank"
          rel="noopener noreferrer"
          className={`${PRIMARY} w-full sm:w-fit`}
        >
          {REPORT.ctaButton}
        </a>
      </section>

      <p className="text-center">
        <Link href="/audit" className="text-[15px] text-mute underline underline-offset-4 transition-colors hover:text-white">
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
        <h1 className="text-2xl font-bold leading-snug text-white sm:text-3xl">
          {view.kind === "missing" ? FORM.notFound : (FAILURES[view.failure] ?? FAILURES.error)}
        </h1>
        <Link href="/audit" className={PRIMARY}>
          {view.kind === "failed" ? REPORT.retry : REPORT.backToForm}
        </Link>
      </section>
    </Shell>
  );
}
