// Opens a site the way a visitor's browser would, within hard limits, and hands
// back facts. No opinions: score.ts forms those.
//
// WHAT "FULL WEBSITE" MEANS HERE, said plainly because the page must not
// promise more: the homepage plus up to four key pages (services, contact,
// about, and one more from the menu). Page weight comes from the homepage and
// a SAMPLE of its files, not a download of everything.
//
// LIMITS, all in one place so they are easy to see and change:
//   25 s for the whole audit, 40 requests, 2 MB per page, 20 files measured.

import {
  assertSafeUrl,
  domainOf,
  normalizeUserUrl,
  probeSize,
  safeFetch,
  UnsafeUrlError,
  type FetchContext,
  type FetchResult,
} from "./safe-fetch.ts";
import { analyzeCss, analyzeHtml, JUNK_PAGE, pickKeyPages } from "./analyze.ts";
import type { CrawlResult, NetworkFacts, PageFacts } from "./types.ts";

const TOTAL_MS = 25_000;
const REQUEST_BUDGET = 40;
const MAX_PAGES = 5; // homepage + 4
const CSS_READS = 4; // big sites split their CSS; one file can hold all the @media rules
const PAGE_BYTES = 2_000_000;

/** Run `fn` over `items`, at most `limit` at a time, keeping the order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Bytes -> text. Arabic sites older than ~2012 are often windows-1256, and
 * reading those as UTF-8 turns every letter into a question mark, which would
 * make a perfectly good Arabic site score as "no Arabic".
 */
export function decodeBody(body: Buffer, contentType: string | undefined): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  if (!charset) {
    // The <meta charset> sits in the first bytes; reading them as latin1 is safe for that.
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 4096).toString("latin1"))?.[1];
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function toFacts(r: FetchResult): PageFacts {
  const html = decodeBody(r.body, String(r.headers["content-type"] ?? ""));
  return analyzeHtml(html, r.url, {
    status: r.status,
    transferBytes: r.wireBytes,
    fetchMs: r.ms,
    contentEncoding: String(r.headers["content-encoding"] ?? "") || null,
  });
}

const isHtml = (r: FetchResult) => /html|xml/i.test(String(r.headers["content-type"] ?? "text/html"));

/** n items spread evenly through the list, not the first n. The first images on a page are its big hero shots. */
function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export async function crawlSite(input: string): Promise<CrawlResult> {
  const ctx: FetchContext = { deadline: Date.now() + TOTAL_MS, budget: { left: REQUEST_BUDGET } };
  const notes: string[] = [];

  // ---- 1. The homepage ----------------------------------------------------------
  let start: string;
  try {
    start = normalizeUserUrl(input);
    assertSafeUrl(start);
  } catch (error) {
    return { ok: false, reason: "blocked", detail: (error as Error).message };
  }

  let home: FetchResult;
  try {
    home = await safeFetch(start, { ctx, maxBytes: PAGE_BYTES });
  } catch (error) {
    if (error instanceof UnsafeUrlError) return { ok: false, reason: "blocked", detail: error.message };
    // https did not answer. A site can be http-only, and that is itself a finding, so try once.
    if (!start.startsWith("http://")) {
      try {
        home = await safeFetch(start.replace(/^https:/i, "http:"), { ctx, maxBytes: PAGE_BYTES });
        notes.push("https_unavailable");
      } catch (second) {
        const e = second as NodeJS.ErrnoException;
        return { ok: false, reason: "unreachable", detail: e.code ?? e.message };
      }
    } else {
      const e = error as NodeJS.ErrnoException;
      return { ok: false, reason: "unreachable", detail: e.code ?? e.message };
    }
  }

  if (home.status >= 300) {
    // 4xx/5xx, or a 3xx we gave up following (a redirect loop or a chain longer than 5).
    return { ok: false, reason: "unreachable", detail: home.status < 400 ? "redirect loop" : `HTTP ${home.status}` };
  }
  if (!isHtml(home)) {
    return { ok: false, reason: "not_html", detail: String(home.headers["content-type"] ?? "") };
  }
  if (home.truncated) notes.push("homepage_truncated");

  const homeFacts = toFacts(home);
  const finalUrl = home.url;
  const host = new URL(finalUrl).hostname;
  const bare = domainOf(finalUrl);

  // ---- 2. Key pages ----------------------------------------------------------------
  const picked = pickKeyPages(homeFacts.internalLinks);
  const chosen = new Set(Object.values(picked).filter((u): u is string => Boolean(u)));
  if (chosen.size < MAX_PAGES - 1) {
    // One more: the shallowest menu link not already picked.
    const extra = [...homeFacts.internalLinks]
      .filter((l) => !chosen.has(l.url) && !JUNK_PAGE.test(l.url))
      .sort((a, b) => new URL(a.url).pathname.split("/").length - new URL(b.url).pathname.split("/").length)[0];
    if (extra) chosen.add(extra.url);
  }

  const pageResults = await mapPool([...chosen].slice(0, MAX_PAGES - 1), 4, async (url) => {
    try {
      const r = await safeFetch(url, { ctx, maxBytes: 1_500_000, timeoutMs: 8000 });
      if (r.status >= 300 || !isHtml(r)) return null;
      if (domainOf(r.url) !== bare) return null; // a link that leads off the site is not a page of it
      if (JUNK_PAGE.test(r.url)) return null; // a menu link that lands on the site's own error page
      return toFacts(r);
    } catch {
      return null;
    }
  });
  const pages = [homeFacts, ...pageResults.filter((p): p is PageFacts => p !== null)];

  // ---- 3. http -> https, and the certificate -------------------------------------------
  const https = finalUrl.startsWith("https:");
  let httpToHttps: NetworkFacts["httpToHttps"] = "not_applicable";
  if (https) {
    try {
      const r = await safeFetch(`http://${host}/`, { ctx, maxRedirects: 0, headersOnly: true, timeoutMs: 6000 });
      const location = String(r.headers.location ?? "");
      httpToHttps = r.status >= 300 && r.status < 400 && location.startsWith("https:") ? "redirects" : "no_redirect";
    } catch {
      httpToHttps = "unreachable";
    }
  }

  const cert: NetworkFacts["cert"] = https
    ? { valid: !home.tls?.error, error: home.tls?.error, daysLeft: home.tls?.daysLeft ?? null }
    : { valid: null, daysLeft: null };

  // ---- 4. Weight: a sample of the homepage's files ------------------------------------------
  const refs = homeFacts.assetRefs;
  const byKind = (kind: string) => refs.filter((r) => r.kind === kind);
  const css = byKind("css").slice(0, CSS_READS);
  // About 17 files, because a file the server will not size costs a second request
  // and the whole audit has 40. Images are most of the weight, and they are sampled
  // evenly through the page so the median is not just the hero images.
  const sample = [
    ...css,
    ...spread(byKind("image"), 7),
    ...spread(byKind("script"), 4),
    ...byKind("font").slice(0, 2),
  ];

  const cssTotals = { filesRead: 0, mediaQueries: homeFacts.inlineMedia, rtlRules: homeFacts.inlineCssRtl, fixedWidthDecls: 0 };
  const sizes = await mapPool(sample, 6, async (ref) => {
    if (ref.kind === "css" && css.includes(ref)) {
      try {
        const r = await safeFetch(ref.url, { ctx, maxBytes: 400_000, timeoutMs: 6000, maxRedirects: 3 });
        if (r.status === 200) {
          const a = analyzeCss(decodeBody(r.body, String(r.headers["content-type"] ?? "")));
          cssTotals.filesRead += 1;
          cssTotals.mediaQueries += a.media;
          cssTotals.rtlRules += a.rtl;
          cssTotals.fixedWidthDecls += a.fixedWidth;
          return { ref, bytes: r.truncated ? 400_000 : r.body.length };
        }
      } catch {
        /* an unreadable stylesheet is "unknown", not "bad" */
      }
      return { ref, bytes: null };
    }
    return { ref, bytes: await probeSize(ref.url, ctx) };
  });

  const known = sizes.filter((s): s is { ref: typeof s.ref; bytes: number } => s.bytes !== null);
  const knownBytes = known.reduce((sum, s) => sum + s.bytes, 0);
  const unknownCount = refs.length - known.length;
  // The files we did not measure are guessed at the median of the ones we did,
  // per kind. A guess, and the report calls the total "approximate".
  const medianBy = (kind: string) => median(known.filter((s) => s.ref.kind === kind).map((s) => s.bytes)) || median(known.map((s) => s.bytes)) || 30_000;
  const guessed = refs
    .filter((r) => !known.some((s) => s.ref.url === r.url))
    .reduce((sum, r) => sum + medianBy(r.kind), 0);
  const htmlBytes = home.wireBytes;

  const network: NetworkFacts = {
    inputUrl: start,
    finalUrl,
    host,
    https,
    httpToHttps,
    cert,
    requestsMade: REQUEST_BUDGET - ctx.budget.left,
    weight: {
      htmlBytes,
      knownAssetBytes: knownBytes,
      assetsTotal: refs.length,
      assetsProbed: sample.length,
      assetsUnknownSize: unknownCount,
      estimatedTotalBytes: htmlBytes + knownBytes + guessed,
      largest: [...known].sort((a, b) => b.bytes - a.bytes).slice(0, 3).map((s) => ({ bytes: s.bytes, url: s.ref.url.slice(0, 140) })),
    },
    css: cssTotals,
  };

  if (ctx.budget.left <= 0) notes.push("request_budget_used");
  if (Date.now() >= ctx.deadline) notes.push("time_budget_used");

  return { ok: true, pages, network, notes };
}
