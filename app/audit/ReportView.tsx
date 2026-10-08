"use client";

// The report page: waits for the audit (polling /api/audit/<id>), then shows it.
//
// Imports TYPES from lib/audit/types and WORDS from lib/audit/copy-ar, and nothing
// else from lib/audit: the crawler and scorer use Node modules (dns, http) that
// must never be bundled into the browser.

import Link from "next/link";
import { useEffect, useState } from "react";
import { CATEGORIES, FAILURES, FINDINGS, FORM, GRADES, OBSERVATIONS, parts, REPORT, UNVERIFIED } from "@/lib/audit/copy-ar";
import type { AuditReport, Finding } from "@/lib/audit/types";

type Api = { status: "running" | "done" | "failed"; domain: string; report: AuditReport | null; failure: string | null };
type View =
  | { kind: "waiting"; domain?: string }
  | { kind: "done"; domain: string; report: AuditReport }
  | { kind: "failed"; domain?: string; failure: string }
  | { kind: "missing" };

const POLL_MS = 1500;
const GIVE_UP_MS = 100_000; // the server marks a lost job as failed at 90 s; this is the backstop

const GRADE_STYLE: Record<string, { text: string; bar: string }> = {
  excellent: { text: "text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-600 dark:bg-emerald-500" },
  good: { text: "text-lime-700 dark:text-lime-400", bar: "bg-lime-600 dark:bg-lime-500" },
  needs_work: { text: "text-amber-700 dark:text-amber-400", bar: "bg-amber-600 dark:bg-amber-500" },
  weak: { text: "text-red-700 dark:text-red-400", bar: "bg-red-600 dark:bg-red-500" },
};

// The same bands as lib/audit/score.ts gradeOf, kept here so this file does not
// import the scorer (and its Node-only dependencies) into the browser.
function band(percent: number): string {
  return percent >= 85 ? "excellent" : percent >= 70 ? "good" : percent >= 50 ? "needs_work" : "weak";
}

const CARD = "rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-10 dark:bg-black sm:px-6 sm:py-14">
      <main className="flex w-full max-w-2xl flex-col gap-8">{children}</main>
    </div>
  );
}

function Domain({ value }: { value: string }) {
  return <bdi dir="ltr">{value}</bdi>;
}

// ---------------------------------------------------------------- waiting

function Waiting({ domain }: { domain?: string }) {
  return (
    <Shell>
      <header className="flex flex-col gap-2" aria-live="polite">
        <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">{REPORT.progressTitle}</h1>
        {domain && (
          <p className="text-lg text-zinc-600 dark:text-zinc-400">
            <Domain value={domain} />
          </p>
        )}
      </header>
      <ul className={`${CARD} flex flex-col gap-3`}>
        {REPORT.progressSteps.map((step, i) => (
          <li key={step} className="flex items-center gap-3 text-zinc-700 dark:text-zinc-300">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full bg-accent motion-safe:animate-pulse"
              style={{ animationDelay: `${i * 250}ms` }}
            />
            {step}
          </li>
        ))}
      </ul>
      <p className="text-sm leading-7 text-zinc-500 dark:text-zinc-400">{REPORT.progressNote}</p>
    </Shell>
  );
}

// ---------------------------------------------------------------- pieces of the report

function Ring({ score, grade }: { score: number; grade: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className={`relative size-36 shrink-0 ${GRADE_STYLE[grade].text}`} role="img" aria-label={`${REPORT.scoreLabel}: ${score} ${REPORT.outOf}`}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-zinc-200 dark:stroke-zinc-800" />
        <circle
          cx="60" cy="60" r={r} fill="none" strokeWidth="10" strokeLinecap="round" stroke="currentColor"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span dir="ltr" className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">{score}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{REPORT.outOf}</span>
      </div>
    </div>
  );
}

function FindingCard({ finding, rank }: { finding: Finding; rank?: number }) {
  const copy = FINDINGS[finding.id];
  if (!copy) return null;
  const evidence = copy.evidence?.(finding.params);
  return (
    <article className={CARD}>
      <h3 className="flex items-start gap-3 text-lg font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
        {rank && (
          <span aria-hidden="true" className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
            {rank}
          </span>
        )}
        <span><Rich text={copy.title} /></span>
      </h3>
      {evidence && (
        <p className="mt-3 rounded-xl bg-zinc-100 px-3 py-2 text-sm leading-7 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <span className="font-medium">{REPORT.evidence}: </span>
          <Rich text={evidence} />
        </p>
      )}
      <p className="mt-3 text-base leading-8 text-zinc-700 dark:text-zinc-300">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{REPORT.why} </span>
        <Rich text={copy.why} />
      </p>
      <p className="mt-2 text-base leading-8 text-zinc-700 dark:text-zinc-300">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{REPORT.fix} </span>
        <Rich text={copy.fix} />
      </p>
    </article>
  );
}

/**
 * Text with `code` spans. Each code span is an inline-block with dir="ltr", which
 * isolates it from the Arabic around it. Without that the bidi algorithm reorders
 * a snippet like <meta name="viewport"> and splits it around the Arabic words.
 */
function Rich({ text }: { text: string }) {
  return (
    <>
      {parts(text).map((p, i) =>
        p.code ? (
          <code
            key={i}
            dir="ltr"
            className="mx-0.5 inline-block max-w-full break-all rounded-md bg-zinc-100 px-1.5 py-0.5 align-baseline font-mono text-[0.85em] leading-6 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
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

function Mark({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
      <span aria-hidden="true">{ok ? "✓" : "✗"}</span>
      <span className="sr-only">{ok ? REPORT.yes : REPORT.no}</span>
    </span>
  );
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname + u.search) || "/";
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
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{REPORT.pageTitle("").trim()}</p>
        <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
          <Domain value={domain} />
        </h1>
      </header>

      {/* ---- score */}
      {report.score !== null && grade ? (
        <section className={`${CARD} flex flex-col items-center gap-5 sm:flex-row`}>
          <Ring score={report.score} grade={grade} />
          <div className="flex flex-col gap-1 text-center sm:text-start">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{REPORT.scoreLabel}</p>
            <p className={`text-2xl font-bold ${GRADE_STYLE[grade].text}`}>{GRADES[grade].label}</p>
            <p className="text-base leading-8 text-zinc-700 dark:text-zinc-300">{GRADES[grade].line}</p>
          </div>
        </section>
      ) : (
        <section className={CARD}>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{REPORT.noScoreTitle}</h2>
          <p className="mt-2 text-base leading-8 text-zinc-700 dark:text-zinc-300">{UNVERIFIED.js_shell}</p>
        </section>
      )}

      {/* ---- categories */}
      {report.score !== null && (
        <section aria-labelledby="cats" className="flex flex-col gap-3">
          <h2 id="cats" className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{REPORT.categories}</h2>
          <ul className={`${CARD} flex flex-col gap-4`}>
            {report.categories.map((c) => {
              const pct = c.score === null ? 0 : Math.round((c.score / c.max) * 100);
              return (
                <li key={c.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{CATEGORIES[c.id].name}</span>
                    <span dir="ltr" className="text-sm text-zinc-600 dark:text-zinc-400">
                      {c.score === null ? "—" : `${c.score}/${c.max}`}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
                    <div className={`h-full rounded-full ${GRADE_STYLE[band(pct)].bar}`} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ---- top problems */}
      {report.score !== null && (
        <section aria-labelledby="top" className="flex flex-col gap-3">
          <h2 id="top" className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{REPORT.top3}</h2>
          {top.length ? top.map((f, i) => <FindingCard key={f.id} finding={f} rank={i + 1} />) : <p className={CARD}>{REPORT.nothingToFix}</p>}
        </section>
      )}

      {rest.length > 0 && (
        <details className={CARD}>
          <summary className="cursor-pointer text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {REPORT.allFindings} ({rest.length})
          </summary>
          <div className="mt-4 flex flex-col gap-3">
            {rest.map((f) => <FindingCard key={f.id} finding={f} />)}
          </div>
        </details>
      )}

      {report.observations.map((o) => {
        const copy = OBSERVATIONS[o.id];
        return copy ? (
          <aside key={o.id} className={CARD}>
            <p className="font-medium text-zinc-900 dark:text-zinc-50">{copy.title(o.params)}</p>
            <p className="mt-1 text-base leading-8 text-zinc-700 dark:text-zinc-300">{copy.text}</p>
          </aside>
        ) : null;
      })}

      {/* ---- pages */}
      <section aria-labelledby="pages" className="flex flex-col gap-3">
        <h2 id="pages" className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{REPORT.pages}</h2>
        {/* `relative` is NOT decoration. The ✓/✗ marks carry an sr-only label, which is
            position:absolute. Without a positioned ancestor it is placed against the PAGE,
            not this scroll box, so it escapes the clipping and widened the whole page by 62px
            at 375px. Found by measuring scrollWidth, not by looking. */}
        <div className="relative overflow-x-auto rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="text-start text-zinc-500 dark:text-zinc-400">
                <th scope="col" className="px-4 py-3 text-start font-medium">{REPORT.pageCols.page}</th>
                <th scope="col" className="px-2 py-3 text-start font-medium">{REPORT.pageCols.arabic}</th>
                <th scope="col" className="px-2 py-3 text-start font-medium">{REPORT.pageCols.lang}</th>
                <th scope="col" className="px-2 py-3 text-start font-medium">{REPORT.pageCols.dir}</th>
                <th scope="col" className="px-2 py-3 text-start font-medium">{REPORT.pageCols.viewport}</th>
                <th scope="col" className="px-2 py-3 text-start font-medium">{REPORT.pageCols.contact}</th>
                <th scope="col" className="px-4 py-3 text-start font-medium">{REPORT.pageCols.size}</th>
              </tr>
            </thead>
            <tbody>
              {report.pages.map((p) => (
                <tr key={p.url} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-4 py-3"><bdi dir="ltr" className="break-all">{pathOf(p.url)}</bdi></td>
                  <td className="px-2 py-3"><bdi dir="ltr">{p.arabicShare}%</bdi></td>
                  <td className="px-2 py-3"><Mark ok={p.langOk} /></td>
                  <td className="px-2 py-3"><Mark ok={p.dirOk} /></td>
                  <td className="px-2 py-3"><Mark ok={p.viewportOk} /></td>
                  <td className="px-2 py-3"><Mark ok={p.hasDirectContact} /></td>
                  <td className="px-4 py-3"><bdi dir="ltr">{p.kb} KB</bdi></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- what we could not check, and the method */}
      {report.unverified.length > 0 && (
        <section className={CARD}>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{REPORT.notChecked}</h2>
          <ul className="mt-2 list-disc ps-5 text-base leading-8 text-zinc-700 dark:text-zinc-300">
            {report.unverified.filter((id) => id !== "js_shell").map((id) => <li key={id}>{UNVERIFIED[id] ?? id}</li>)}
          </ul>
        </section>
      )}

      <details className={CARD}>
        <summary className="cursor-pointer font-semibold text-zinc-900 dark:text-zinc-50">{REPORT.methodTitle}</summary>
        <p className="mt-3 text-sm leading-7 text-zinc-700 dark:text-zinc-300">{REPORT.methodChecked}</p>
        <p className="mt-2 text-sm leading-7 text-zinc-700 dark:text-zinc-300">{REPORT.methodLimits}</p>
      </details>

      {/* ---- next step */}
      <section className={`${CARD} flex flex-col gap-3`}>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{REPORT.ctaTitle}</h2>
        <p className="text-base leading-8 text-zinc-700 dark:text-zinc-300">{REPORT.ctaText}</p>
        <a
          href={whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}` : "https://waelwebdesign.com/contact"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-12 items-center justify-center rounded-xl bg-accent px-5 text-base font-medium text-white transition-opacity hover:opacity-90"
        >
          {REPORT.ctaButton}
        </a>
      </section>

      <p className="text-center">
        <Link href="/audit" className="text-sm text-accent-text underline underline-offset-2">
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
    <Shell>
      <section className={`${CARD} flex flex-col gap-4`}>
        {view.kind === "failed" && view.domain && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            <Domain value={view.domain} />
          </p>
        )}
        <h1 className="text-2xl font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
          {view.kind === "missing" ? FORM.notFound : (FAILURES[view.failure] ?? FAILURES.error)}
        </h1>
        <Link href="/audit" className="flex h-12 items-center justify-center rounded-xl bg-accent px-5 text-base font-medium text-white transition-opacity hover:opacity-90">
          {view.kind === "failed" ? REPORT.retry : REPORT.backToForm}
        </Link>
      </section>
    </Shell>
  );
}
