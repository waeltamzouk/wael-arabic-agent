// Turns crawl facts into a score out of 100, plus the list of what cost points.
//
// THE RULES ARE HERE, IN CODE, NOT IN A PROMPT. The same site always gets the
// same number, nothing is invented, and Wael can read exactly why a site lost
// a point. The Arabic wording for each finding is in copy-ar.ts, keyed by the
// `id`s below; change a sentence there without touching a rule here.
//
// FIVE CATEGORIES (points): Arabic 30 · Mobile 20 · Contact 20 · Speed 15 · Trust 15.
//
// THE HONESTY RULE. Each check is "earned out of max" or UNVERIFIED. An
// unverified check (a stylesheet we could not read, a page we could not size)
// is left out of the maths instead of being counted as a failure, and the
// category score is scaled to what could be verified. A site is never marked
// down for something we could not see. And a page that is just an empty shell
// for JavaScript gets NO score at all: the raw HTML tells us nothing about it.

import { pickKeyPages } from "./analyze.ts";
import { domainOf } from "./safe-fetch.ts";
import type { AuditReport, CategoryId, CategoryScore, CrawlResult, Finding, PageFacts, PageRow } from "./types.ts";

type Check = {
  id: string;
  category: CategoryId;
  max: number;
  /** null = could not be verified. */
  earned: number | null;
  params?: Record<string, string | number>;
  /** Do not list in "what we could not check" when unverified (too minor to mention). */
  quiet?: boolean;
};

export const CATEGORY_MAX: Record<CategoryId, number> = { arabic: 30, mobile: 20, contact: 20, speed: 15, trust: 15 };
const ORDER: CategoryId[] = ["arabic", "contact", "mobile", "speed", "trust"];

const MB = 1_048_576;
const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const major = (v: string) => Number(v.split(".")[0]);

export function gradeOf(score: number): NonNullable<AuditReport["grade"]> {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "needs_work";
  return "weak";
}

type Ok = Extract<CrawlResult, { ok: true }>;

function checksFor(crawl: Ok, year: number): Check[] {
  const { pages, network: net } = crawl;
  const home = pages[0];
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // ===================== ARABIC (30) =====================
  const arabicPages = pages.filter((p) => p.arabicRatio >= 0.5 && p.arabicChars > 50);
  const hasArabic =
    pages.some((p) => p.arabicChars > 50) || pages.some((p) => p.hreflang.some((h) => h.lang.toLowerCase().startsWith("ar")));

  if (!hasArabic) {
    add({ id: "ar_missing", category: "arabic", max: 30, earned: 0 });
  } else {
    const r = home.arabicRatio;
    add({
      id: "ar_not_default", category: "arabic", max: 10,
      earned: r >= 0.6 ? 10 : r >= 0.3 ? 5 : 0, params: { percent: Math.round(r * 100) },
    });

    // The next four only make sense on pages that ARE Arabic. If none of the pages we
    // read is, we cannot say anything about them, so they are unverified, not failed.
    // With no Arabic page to look at, say nothing: "ar_not_default" already told the story.
    const quiet = arabicPages.length === 0;
    const langFrac = arabicPages.length ? avg(arabicPages.map((p) => (p.htmlLang?.toLowerCase().startsWith("ar") ? 1 : 0))) : null;
    add({
      id: "ar_lang_missing", category: "arabic", max: 4,
      earned: langFrac === null ? null : Math.round(4 * langFrac),
      params: { lang: home.htmlLang ?? "—" }, quiet,
    });

    const dirFrac = arabicPages.length
      ? avg(
          arabicPages.map((p) =>
            p.htmlDir?.toLowerCase() === "rtl" || p.bodyDir?.toLowerCase() === "rtl"
              ? 1
              : p.inlineRtl > 0 || net.css.rtlRules > 0
                ? 0.5 // direction set by CSS only: works, but fragile and invisible to screen readers
                : 0
          )
        )
      : null;
    add({ id: "ar_dir_missing", category: "arabic", max: 8, earned: dirFrac === null ? null : Math.round(8 * dirFrac), params: { dir: home.htmlDir ?? "—" }, quiet });

    const leftCount = arabicPages.reduce((s, p) => s + p.inlineTextAlignLeft, 0);
    add({ id: "ar_rtl_inconsistent", category: "arabic", max: 3, earned: arabicPages.length ? (leftCount >= 3 ? 0 : 3) : null, params: { count: leftCount }, quiet });

    const punct = arabicPages.reduce((s, p) => s + p.latinPunctCount, 0);
    const example = arabicPages.flatMap((p) => p.latinPunctExamples)[0] ?? "";
    add({
      id: "ar_punctuation", category: "arabic", max: 3,
      earned: arabicPages.length ? (punct === 0 ? 3 : punct <= 2 ? 2 : punct <= 5 ? 1 : 0) : null,
      params: { count: punct, example }, quiet,
    });

    // A switch only matters when the site speaks two languages.
    const bilingual = pages.some((p) => p.latinChars > 200 && p.arabicRatio < 0.9);
    const hasSwitch = pages.some((p) => p.switchLinks.length > 0 || p.hreflang.length > 0);
    add({ id: "ar_no_switch", category: "arabic", max: 2, earned: !bilingual || hasSwitch ? 2 : 0 });
  }

  // ===================== MOBILE (20) =====================
  const vp = home.viewport?.toLowerCase() ?? null;
  add({
    id: vp === null ? "mob_no_viewport" : "mob_viewport_bad", category: "mobile", max: 8,
    earned: vp === null ? 0 : /width\s*=\s*device-width/.test(vp) ? 8 : 4,
    params: { content: home.viewport ?? "—" },
  });

  const media = net.css.mediaQueries;
  const cssUnreadable = net.css.filesRead === 0 && home.stylesheets > 0;
  const cssInJs = home.stylesheets === 0 && home.scripts > 10; // styles injected by JavaScript: invisible to us
  add({
    id: "mob_not_responsive", category: "mobile", max: 8,
    earned: media > 0 ? 8 : cssUnreadable || cssInJs ? null : 0,
    params: { files: net.css.filesRead },
  });

  const fixedCss = net.css.fixedWidthDecls > 0 && media === 0;
  add({
    id: "mob_fixed_layout", category: "mobile", max: 4,
    earned: home.tables >= 4 || home.fixedWidthInline > 0 || fixedCss ? 0 : 4,
    params: { tables: home.tables },
  });

  // ===================== SPEED (15) =====================
  const w = net.weight;
  const mb = w.estimatedTotalBytes / MB;
  const knownAssets = w.assetsTotal - w.assetsUnknownSize;
  const weightUnknown = w.assetsTotal > 5 && knownAssets < 3;
  add({
    id: "spd_weight", category: "speed", max: 6,
    earned: weightUnknown ? null : mb <= 2.5 ? 6 : mb <= 5 ? 4 : mb <= 8 ? 2 : 0,
    params: { mb: Math.round(mb * 10) / 10 },
  });

  const requests = w.assetsTotal + 1;
  add({ id: "spd_requests", category: "speed", max: 4, earned: requests <= 40 ? 4 : requests <= 80 ? 2 : 0, params: { requests } });

  const biggest = w.largest[0]?.bytes ?? 0;
  const noLazy = home.images > 8 && home.imagesLazy === 0;
  add({
    id: "spd_images", category: "speed", max: 5,
    earned: Math.max(0, 5 - (biggest > 500_000 ? 3 : 0) - (noLazy ? 2 : 0)),
    params: { biggestKb: Math.round(biggest / 1024), images: home.images, lazy: home.imagesLazy },
  });

  // ===================== CONTACT (20) =====================
  const direct = pages.some((p) => p.tel.length > 0 || p.whatsapp.length > 0);
  const anyForm = pages.some((p) => p.forms > 0) || home.bookingHint;
  const anyEmail = pages.some((p) => p.emails.length > 0);
  add({ id: "con_no_direct", category: "contact", max: 8, earned: direct ? 8 : anyForm || anyEmail ? 3 : 0 });

  const pct = home.earliestContactPct;
  add({
    id: "con_not_visible", category: "contact", max: 6,
    earned: home.floatingWhatsapp || (pct !== null && pct <= 25) ? 6 : pct !== null && pct <= 50 ? 4 : pct !== null ? 2 : 0,
    params: { percent: pct ?? -1 },
  });

  add({ id: "con_no_form", category: "contact", max: 4, earned: anyForm ? 4 : direct ? 2 : 0 });
  add({ id: "con_no_contact_page", category: "contact", max: 2, earned: pickKeyPages(home.internalLinks).contact ? 2 : 0 });

  // ===================== TRUST (15) =====================
  add({ id: "trust_no_https", category: "trust", max: 5, earned: net.https ? 5 : 0 });
  add({
    id: "trust_no_redirect", category: "trust", max: 2,
    earned: !net.https ? null : net.httpToHttps === "redirects" ? 2 : net.httpToHttps === "no_redirect" ? 0 : 1,
    quiet: true,
  });
  add({
    id: "trust_cert", category: "trust", max: 2,
    earned: !net.https ? null : net.cert.valid === false ? 0 : (net.cert.daysLeft ?? 99) < 14 ? 1 : 2,
    params: { error: net.cert.error ?? "", days: net.cert.daysLeft ?? -1 },
    quiet: true,
  });

  const latestYear = pages.reduce<number | null>((m, p) => (p.copyrightYear && (!m || p.copyrightYear > m) ? p.copyrightYear : m), null);
  add({
    id: "trust_copyright_old", category: "trust", max: 2,
    earned: latestYear === null ? null : latestYear >= year - 1 ? 2 : latestYear === year - 2 ? 1 : 0,
    params: { year: latestYear ?? 0 },
    quiet: true,
  });

  const oldJq = home.jquery.find((v) => major(v) < 3);
  const oldBs = home.bootstrap.find((v) => major(v) < 4);
  add({
    id: "trust_old_libs", category: "trust", max: 1, earned: oldJq || oldBs ? 0 : 1,
    params: { lib: oldJq ? `jQuery ${oldJq}` : oldBs ? `Bootstrap ${oldBs}` : "" },
  });

  const oldTags = Object.keys(home.oldTags);
  add({ id: "trust_old_tags", category: "trust", max: 1, earned: oldTags.length || home.flash ? 0 : 1, params: { tags: oldTags.join(" ") || (home.flash ? "Flash" : "") } });
  add({ id: "trust_no_title", category: "trust", max: 1, earned: home.title.length >= 10 ? 1 : 0 });
  add({ id: "trust_no_description", category: "trust", max: 1, earned: home.metaDescription ? 1 : 0 });

  return checks;
}

function rowOf(p: PageFacts): PageRow {
  return {
    url: p.url,
    status: p.status,
    arabicShare: Math.round(p.arabicRatio * 100),
    langOk: Boolean(p.htmlLang?.toLowerCase().startsWith("ar")),
    dirOk: p.htmlDir?.toLowerCase() === "rtl" || p.bodyDir?.toLowerCase() === "rtl",
    viewportOk: Boolean(p.viewport && /width\s*=\s*device-width/i.test(p.viewport)),
    hasDirectContact: p.tel.length > 0 || p.whatsapp.length > 0,
    kb: Math.round(p.transferBytes / 1024),
  };
}

export function scoreAudit(crawl: Ok, now: Date = new Date()): AuditReport {
  const { pages, network: net } = crawl;
  const home = pages[0];
  const domain = domainOf(net.finalUrl);
  const rows = pages.map(rowOf);

  // A page that JavaScript fills in tells raw HTML nothing. No number is fairer than a wrong one.
  if (home.jsShell) {
    return {
      domain, score: null, grade: null, partial: true,
      categories: ORDER.map((id) => ({ id, score: null, max: CATEGORY_MAX[id] })),
      findings: [], top: [], observations: [], pages: rows, unverified: ["js_shell"],
      approxWeightMb: null, requestsEstimated: null,
    };
  }

  const checks = checksFor(crawl, now.getFullYear());

  const categories: CategoryScore[] = ORDER.map((id) => {
    const verified = checks.filter((c) => c.category === id && c.earned !== null);
    const max = verified.reduce((s, c) => s + c.max, 0);
    const earned = verified.reduce((s, c) => s + (c.earned ?? 0), 0);
    return { id, score: max === 0 ? null : Math.round((earned / max) * CATEGORY_MAX[id]), max: CATEGORY_MAX[id] };
  });

  // Total: earned / verifiable, so an unverified check neither helps nor hurts.
  const verifiedAll = checks.filter((c) => c.earned !== null);
  const maxAll = verifiedAll.reduce((s, c) => s + c.max, 0);
  const earnedAll = verifiedAll.reduce((s, c) => s + (c.earned ?? 0), 0);
  const score = maxAll === 0 ? null : Math.round((earnedAll / maxAll) * 100);

  const findings: Finding[] = checks
    .filter((c) => c.earned !== null && c.earned < c.max)
    .map((c) => ({ id: c.id, category: c.category, lost: c.max - (c.earned ?? 0), params: c.params ?? {} }))
    .sort((a, b) => b.lost - a.lost || ORDER.indexOf(a.category) - ORDER.indexOf(b.category));

  // Things worth saying that cost nothing.
  const observations: Finding[] = [];
  if (pages.some((p) => p.chatWidgets.length > 0)) {
    const name = pages.flatMap((p) => p.chatWidgets)[0];
    observations.push({ id: "obs_chat_thirdparty", category: "contact", lost: 0, params: { name } });
  } else if (pages.some((p) => p.customChat.length > 0)) {
    // A bubble the site built itself, or a tool not on our list. A known tool wins above.
    observations.push({ id: "obs_chat_custom", category: "contact", lost: 0, params: {} });
  } else {
    // Raw HTML cannot prove there is NO chat (a script can add one later), so this id
    // means "no known tool found", and its words say so. The id stays: saved reports use it.
    observations.push({ id: "obs_chat_none", category: "contact", lost: 0, params: {} });
  }

  const unverified = checks.filter((c) => c.earned === null && !c.quiet).map((c) => c.id);
  if (crawl.notes.includes("time_budget_used") || crawl.notes.includes("request_budget_used")) unverified.push("limits_reached");

  return {
    domain,
    score,
    grade: score === null ? null : gradeOf(score),
    partial: unverified.length >= 3,
    categories,
    findings,
    top: findings.slice(0, 3).map((f) => f.id),
    observations,
    pages: rows,
    unverified,
    approxWeightMb: Math.round((net.weight.estimatedTotalBytes / MB) * 10) / 10,
    requestsEstimated: net.weight.assetsTotal + 1,
  };
}
