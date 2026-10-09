// Shared shapes for the Arabic website audit. Types only: nothing here runs.
//
// The audit has three stages, and each hands the next one plain data:
//   crawl.ts   fetches pages        -> CrawlResult  (facts, no opinions)
//   score.ts   judges those facts   -> AuditReport  (points, findings)
//   copy-ar.ts turns finding ids into the Arabic words a visitor reads
// Keeping facts and opinions apart is what makes the score repeatable: the same
// site gives the same numbers, and the Arabic wording can be edited without
// touching a single rule.

export type CategoryId = "arabic" | "mobile" | "speed" | "contact" | "trust";

/** Everything one page told us about itself. Pure facts, no judgement. */
export type PageFacts = {
  url: string;
  status: number;
  title: string;
  metaDescription: string;
  htmlLang: string | null;
  htmlDir: string | null;
  bodyDir: string | null;
  arabicChars: number;
  latinChars: number;
  /** Arabic letters / (Arabic + Latin letters) in the visible text, 0..1. */
  arabicRatio: number;
  /** Links that look like a language switch (text "English", hreflang, /en/ ...). */
  switchLinks: { text: string; href: string }[];
  hreflang: { lang: string; href: string }[];
  /** A Latin `, ; ?` straight after an Arabic letter (Arabic has its own ، ؛ ؟). */
  latinPunctCount: number;
  latinPunctExamples: string[];
  arabicPunctCount: number;
  inlineRtl: number;
  inlineTextAlignLeft: number;
  inlineMedia: number;
  inlineCssRtl: number;
  viewport: string | null;
  tables: number;
  fixedWidthInline: number;
  tel: string[];
  whatsapp: string[];
  emails: string[];
  forms: number;
  formFields: number;
  bookingHint: boolean;
  floatingWhatsapp: boolean;
  /** How far down the page's HTML the earliest contact link sits, 0..100. A proxy for "above the fold". */
  earliestContactPct: number | null;
  chatWidgets: string[];
  /** Marks of a chat window that is NOT a known tool (the site's own bubble), as short evidence strings. Max 4. */
  customChat: string[];
  platforms: string[];
  jquery: string[];
  bootstrap: string[];
  oldTags: Record<string, number>;
  flash: boolean;
  copyrightYear: number | null;
  copyrightText: string[];
  images: number;
  imagesMissingAlt: number;
  imagesLazy: number;
  scripts: number;
  stylesheets: number;
  mixedContentRefs: number;
  visibleChars: number;
  textSample: string;
  /** The page is an empty shell that JavaScript fills in: raw HTML tells us almost nothing. */
  jsShell: boolean;
  headings: { tag: string; text: string }[];
  internalLinks: { url: string; text: string }[];
  assetRefs: { kind: "css" | "script" | "image" | "font" | "other"; url: string }[];
  transferBytes: number;
  fetchMs: number;
  contentEncoding: string | null;
};

export type NetworkFacts = {
  inputUrl: string;
  finalUrl: string;
  host: string;
  https: boolean;
  /** What `http://host/` does: sends you to https, stays on http, or cannot be reached. */
  httpToHttps: "redirects" | "no_redirect" | "unreachable" | "not_applicable";
  cert: { valid: boolean | null; error?: string; daysLeft: number | null };
  requestsMade: number;
  weight: {
    htmlBytes: number;
    /** Sum of the assets whose size we could read. */
    knownAssetBytes: number;
    assetsTotal: number;
    assetsProbed: number;
    assetsUnknownSize: number;
    /** HTML + known assets + a guess for the unmeasured rest. Rough, and the report says so. */
    estimatedTotalBytes: number;
    largest: { bytes: number; url: string }[];
  };
  css: { filesRead: number; mediaQueries: number; rtlRules: number; fixedWidthDecls: number };
};

export type CrawlResult =
  | { ok: true; pages: PageFacts[]; network: NetworkFacts; notes: string[] }
  | { ok: false; reason: "unreachable" | "blocked" | "not_html" | "error"; detail: string };

export type Finding = {
  /** Key into copy-ar.ts. */
  id: string;
  category: CategoryId;
  /** Points this finding cost. 0 means "worth saying, but free". */
  lost: number;
  /** Small facts shown as evidence. Strings and numbers only. */
  params: Record<string, string | number>;
};

export type CategoryScore = {
  id: CategoryId;
  /** 0..max, scaled to what could be verified. null when nothing in it could be checked. */
  score: number | null;
  max: number;
};

export type PageRow = {
  url: string;
  status: number;
  arabicShare: number;
  langOk: boolean;
  dirOk: boolean;
  viewportOk: boolean;
  hasDirectContact: boolean;
  kb: number;
};

export type AuditReport = {
  domain: string;
  /** null = we could not read the site well enough to give a fair number. */
  score: number | null;
  grade: "excellent" | "good" | "needs_work" | "weak" | null;
  partial: boolean;
  categories: CategoryScore[];
  /** Every finding that cost points, biggest first. */
  findings: Finding[];
  /** Up to 3 ids of the findings to lead with. */
  top: string[];
  /** Things worth saying that cost nothing (e.g. a third-party chat widget). */
  observations: Finding[];
  pages: PageRow[];
  /** What we could NOT verify, as finding-like ids. */
  unverified: string[];
  approxWeightMb: number | null;
  requestsEstimated: number | null;
};
