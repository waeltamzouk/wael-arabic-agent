// What happens after a visitor submits the form, start to finish. Plain code with
// no Next.js in it, so scripts can run it too; the route passes in the one thing
// that does need Next (`count`, which writes the funnel counters).
//
// ORDER, and why:
//   1. save the lead FIRST. The lead is the point of the page. If the function is
//      stopped halfway through a long audit, the address is already on the list.
//   2. run the audit (or wait for the one already running for this site)
//   3. email the visitor their report, once per address per day
//   4. tell Wael, whether the audit worked or not
// Every step is in a try/catch: a failure in one never stops the next.

import { crawlSite } from "./crawl.ts";
import { sendLeadNotice, sendReportEmail } from "./email.ts";
import { RESEND_PACE_MS, saveLead, saveScore, sleep } from "./lead.ts";
import { mayEmailReport } from "./limits.ts";
import { scoreAudit } from "./score.ts";
import { forgetJob, loadJob, saveJob, type Job } from "./store.ts";

export type Submission = {
  job: Job;
  /** True when this site already has an audit running or finished: do not crawl again. */
  reuse: boolean;
  url: string;
  name: string;
  email: string;
  /** Where the report link points, e.g. https://wael-arabic-agent.vercel.app */
  base: string;
  test: boolean;
};

type Deps = { count: (metric: string) => void };

/** Crawl, score, store. Always ends with the job saved as done or failed. */
export async function runAudit(job: Job, url: string, deps: Deps): Promise<Job> {
  try {
    const crawl = await crawlSite(url);
    if (!crawl.ok) {
      const failed: Job = { ...job, status: "failed", failure: crawl.reason };
      await saveJob(failed);
      await forgetJob(job.domain); // so the visitor can try again straight away
      deps.count("audit_failed");
      return failed;
    }
    const done: Job = { ...job, status: "done", report: scoreAudit(crawl) };
    await saveJob(done);
    deps.count("audit_done");
    return done;
  } catch (error) {
    console.error("Audit crashed:", error);
    const failed: Job = { ...job, status: "failed", failure: "error" };
    try {
      await saveJob(failed);
      await forgetJob(job.domain);
    } catch {
      /* the stale-job rule in store.ts will report it as failed anyway */
    }
    deps.count("audit_failed");
    return failed;
  }
}

/** Another visitor's audit of the same site is running: wait for it instead of repeating it. */
async function waitFor(id: string, maxMs: number): Promise<Job | null> {
  const until = Date.now() + maxMs;
  for (;;) {
    const job = await loadJob(id);
    if (!job || job.status !== "running" || Date.now() >= until) return job;
    await sleep(1000);
  }
}

export async function processSubmission(s: Submission, deps: Deps): Promise<void> {
  const link = `${s.base}/audit/r/${s.job.id}`;
  let listOutcome = "not attempted";

  try {
    listOutcome = await saveLead({ email: s.email, name: s.name, domain: s.job.domain });
    if (listOutcome !== "disabled") await sleep(RESEND_PACE_MS);
  } catch (error) {
    console.error("Saving the audit lead failed:", error);
    listOutcome = "failed";
  }

  let final: Job | null = null;
  try {
    final = s.reuse ? await waitFor(s.job.id, 40_000) : await runAudit(s.job, s.url, deps);
  } catch (error) {
    console.error("Audit step failed:", error);
  }

  try {
    if (final?.status === "done" && final.report && (await mayEmailReport(s.email))) {
      await sendReportEmail({ to: s.email, name: s.name, domain: s.job.domain, report: final.report, link, test: s.test });
      await sleep(RESEND_PACE_MS);
    }
    await saveScore(s.email, final?.report?.score ?? null);
    await sleep(RESEND_PACE_MS);
    await sendLeadNotice({
      name: s.name,
      email: s.email,
      domain: s.job.domain,
      report: final?.report ?? null,
      failure: final?.failure ?? (final ? undefined : "did not finish"),
      link,
      listOutcome,
      test: s.test,
    });
  } catch (error) {
    console.error("Audit follow-up emails failed:", error);
  }
}
