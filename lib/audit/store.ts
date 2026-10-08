// Audit jobs and results.
//
// A job is created the moment a visitor submits the form, and the report page
// polls it until it is done. The record holds NO personal data: no name, no
// email. Those go to Resend and to Wael's notice email and nowhere else, which
// keeps the Upstash promise from CLAUDE.md ("nothing personal stored") true.
// The id is 128 random bits, so a report link cannot be guessed; the report is
// private by being unguessable, not by a login.

import { randomBytes } from "node:crypto";
import { kvDel, kvGet, kvSet } from "./kv.ts";
import type { AuditReport } from "./types.ts";

export type Job = {
  id: string;
  status: "running" | "done" | "failed";
  createdAt: number;
  domain: string;
  report?: AuditReport;
  /** Why it failed: a key of FAILURES in copy-ar.ts. */
  failure?: string;
};

const JOB_TTL = 30 * 24 * 60 * 60; // reports live 30 days
const CACHE_TTL = 24 * 60 * 60; // one fresh audit per site per day
/** A job still "running" after this long has lost its worker (the function was stopped). */
export const STALE_AFTER_MS = 90_000;

const jobKey = (id: string) => `audit:job:${id}`;
const cacheKey = (domain: string) => `audit:cache:${domain}`;

export function newJobId(): string {
  return randomBytes(16).toString("base64url"); // 22 characters
}

export function isJobId(value: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(value);
}

export async function saveJob(job: Job): Promise<void> {
  await kvSet(jobKey(job.id), JSON.stringify(job), JOB_TTL);
}

export async function loadJob(id: string): Promise<Job | null> {
  const raw = await kvGet(jobKey(id));
  if (!raw) return null;
  try {
    const job = JSON.parse(raw) as Job;
    // A worker that died leaves "running" behind for ever. Say so, instead of spinning.
    if (job.status === "running" && Date.now() - job.createdAt > STALE_AFTER_MS) {
      return { ...job, status: "failed", failure: "stale" };
    }
    return job;
  } catch {
    return null;
  }
}

/** The audit already running or finished for this site in the last day, if any. */
export async function cachedJob(domain: string): Promise<Job | null> {
  const id = await kvGet(cacheKey(domain));
  if (!id || !isJobId(id)) return null;
  const job = await loadJob(id);
  return job && job.status !== "failed" ? job : null;
}

export async function rememberJob(domain: string, id: string): Promise<void> {
  await kvSet(cacheKey(domain), id, CACHE_TTL);
}

export async function forgetJob(domain: string): Promise<void> {
  await kvDel(cacheKey(domain));
}
