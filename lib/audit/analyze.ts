// Reads ONE page's HTML and reports facts about it. No opinions, no scores:
// that is score.ts. This is the TypeScript twin of
// `.claude/skills/site-audit/scripts/probe.py` (Wael's private audit tool), so
// when a check changes in one, change the other.
//
// It sees what the server SENT. It does not run JavaScript and does not look at
// the page, so it cannot see mirrored icons, a widget's branding, or anything
// a script draws later. The report says so rather than pretending.
//
// htmlparser2 is a streaming parser (callbacks per tag), the same shape as
// Python's HTMLParser, which is why the port is close to line for line.

import { Parser } from "htmlparser2";
import type { PageFacts } from "./types.ts";

const AR = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
const AR_RE = new RegExp(`[${AR}]`, "g");
const LATIN_RE = /[A-Za-z]/g;
const LATIN_PUNCT_RE = new RegExp(`[${AR}]\\s?[,;?]`, "g");
const ARABIC_PUNCT_RE = /[،؛؟]/g;

const SKIP = new Set(["script", "style", "noscript", "template", "svg"]);
const CTA_RE = /contact|call|book|appointment|whatsapp|quote|اتصل|تواصل|احجز|واتساب|موعد|اطلب|استشارة/i;
const WA_RE = /wa\.me|wa\.link|whatsapp/i;
const FLOAT_WA_RE = /whatsapp|wa-?float|wa-?chat|joinchat|float-?whats/i;
const BOOKING_RE = /calendly|acuity|simplybook|setmore|book now|احجز|حجز موعد/i;
const SWITCH_LABELS_FROM_AR = new Set(["english", "en"]);
const SWITCH_LABELS_FROM_EN = new Set(["العربية", "عربي", "ar", "arabic"]);

// Which third-party chat widgets and site builders leave a fingerprint in the HTML.
const CHAT_SIGS: Record<string, string[]> = {
  Chatbase: ["chatbase.co", "chatbase.com"], Tidio: ["tidio.co", "tidiochat"], "Tawk.to": ["tawk.to"],
  Crisp: ["crisp.chat"], Intercom: ["intercom.io", "intercomcdn"], Drift: ["driftt.com", "drift.com"],
  LiveChat: ["livechatinc"], Zendesk: ["zdassets.com", "zopim"], ManyChat: ["manychat"],
  "Respond.io": ["respond.io"], Wati: ["wati.io"], BotPenguin: ["botpenguin"], Smartsupp: ["smartsupp"],
  Freshchat: ["freshchat"], JivoChat: ["jivosite", "jivo.chat"], Olark: ["olark"], "Zoho SalesIQ": ["salesiq"],
  Landbot: ["landbot.io"], Botpress: ["botpress"], Voiceflow: ["voiceflow"], Wittify: ["wittify"],
  Kommunicate: ["kommunicate"], Chaport: ["chaport"], "Joinchat (WhatsApp button)": ["joinchat"],
};

// CHAT_SIGS only knows tools BY NAME, so a bubble a site built itself (or a tool not on
// the list) would read as "no chat". These are the marks such a bubble leaves in its
// attributes. They are looked for on a few element kinds only, never in running text,
// and never on a WhatsApp button (that is a link to a person, not a chat window).
// `chat` must stand alone in the value (`wael-chat-launcher`, `ChatWidget`), so
// `wechat` and `chatter` do not count. Arabic has no \b in JS, hence the lookarounds.
const CHAT_TOKEN_RE =
  /(?<![a-z])(?:live[-_ ]?chat|chat[-_ ]?bot|chat(?:[-_ ]?(?:widget|box|bubble|window|launcher|button|btn|icon|panel|popup|toggle|frame|container|wrapper))?|ai[-_ ]?assistant|virtual[-_ ]?assistant)(?![a-z])/;
const CHAT_AR_RE = /(?<![؀-ۿ])(?:ال)?(?:محادثة|دردشة|شات)(?![؀-ۿ])/;
// "مساعد" is too common on its own ("مساعد المدير"), so only a button or iframe may carry it.
const ASSISTANT_AR_RE = /(?<![؀-ۿ])(?:ال)?مساعد(?![؀-ۿ])/;
const CHAT_TAGS = new Set(["button", "iframe", "div", "span", "section", "aside"]);
const CHAT_STRICT_TAGS = new Set(["button", "iframe"]); // may also be judged by class, src and "مساعد"

/** Evidence that this element is part of a chat window, or null. */
function chatSignal(tag: string, a: Record<string, string>): string | null {
  const fields: [string, string | undefined][] = [["id", a.id], ["aria-label", a["aria-label"]], ["title", a.title]];
  if (CHAT_STRICT_TAGS.has(tag)) fields.push(["class", a.class], ["src", a.src]);
  for (const [key, value] of fields) {
    if (!value) continue;
    const v = value.toLowerCase();
    if (FLOAT_WA_RE.test(v)) continue;
    if (CHAT_TOKEN_RE.test(v) || CHAT_AR_RE.test(v) || (CHAT_STRICT_TAGS.has(tag) && ASSISTANT_AR_RE.test(v))) {
      return `${tag} ${key}="${value.trim().slice(0, 40)}"`;
    }
  }
  return null;
}

const TECH_SIGS: Record<string, string[]> = {
  WordPress: ["wp-content/", "wp-includes/"], Wix: ["wixstatic.com", "parastorage.com"],
  Squarespace: ["squarespace.com", "sqspcdn"], Shopify: ["cdn.shopify.com"],
  Webflow: ["webflow.com", "w-webflow", "assets-global.website-files.com"],
  Framer: ["framerusercontent.com", 'content="framer'], Elementor: ["elementor/", "elementor-"],
  Joomla: ["/media/jui/", "joomla!"], Drupal: ["/sites/default/files", "drupal-settings-json"],
  Salla: ["cdn.salla.network"], Zid: ["cdn.zid.store", "zid.sa/"], Magento: ["magento", "mage/cookies"],
  "GoDaddy builder": ["godaddysites.com", "wsimg.com"],
};
const PAGE_KEYS: Record<"services" | "contact" | "about", string[]> = {
  services: ["services", "service", "solutions", "what-we-do", "specialt", "treatment", "departments", "practice", "خدمات", "خدماتنا", "حلول", "التخصصات", "الأقسام", "أعمالنا", "اعمالنا"],
  contact: ["contact", "reach-us", "appointment", "booking", "book", "اتصل", "تواصل", "احجز", "موعد", "حجز"],
  about: ["about", "who-we-are", "who we are", "our-story", "team", "من نحن", "من-نحن", "نبذة", "عن الشركة", "عن المركز", "عن العيادة", "عن المكتب", "فريق"],
};

export type PageKind = "services" | "contact" | "about";

// Pages that are never "a key page of the business": errors, login, legal, search.
export const JUNK_PAGE = /404|error|login|sign-?in|sign-?up|cart|checkout|privacy|terms|policy|sitemap|search|cookie|account|\.(xml|json)$/i;

type Anchor = { href: string; text: string; hreflang: string; pos: number };

function count(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

function pct(pos: number, total: number): number {
  return Math.round((100 * pos) / Math.max(total, 1));
}

function safeUrl(href: string, base: string): URL | null {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

export function analyzeHtml(
  html: string,
  pageUrl: string,
  meta: { status: number; transferBytes: number; fetchMs: number; contentEncoding: string | null }
): PageFacts {
  let htmlAttrs: Record<string, string> = {};
  let bodyAttrs: Record<string, string> = {};
  const metas: Record<string, string> = {};
  const links: Record<string, string>[] = [];
  const scripts: string[] = [];
  let inlineScripts = 0;
  const imgs: Record<string, string>[] = [];
  const anchors: Anchor[] = [];
  let forms = 0;
  let formFields = 0;
  let title = "";
  const headings: { tag: string; text: string }[] = [];
  const text: string[] = [];
  const counts: Record<string, number> = {};
  let inlineRtl = 0;
  let inlineLeft = 0;
  let inlineFixedWidth = 0;
  let floatingWa = false;
  const customChat: string[] = [];
  const styleText: string[] = [];

  let inBody = false;
  let bodyTags = 0;
  let skip = 0;
  let inTitle = false;
  let inStyle = false;
  let heading: { tag: string; text: string } | null = null;
  let current: Anchor | null = null;

  const parser = new Parser({
    onopentag(name, a) {
      counts[name] = (counts[name] ?? 0) + 1;
      if (inBody) bodyTags += 1;

      switch (name) {
        case "html":
          htmlAttrs = a;
          break;
        case "body":
          bodyAttrs = a;
          inBody = true;
          break;
        case "meta": {
          const key = (a.name || a.property || a["http-equiv"] || "").toLowerCase();
          if (key && metas[key] === undefined) metas[key] = a.content ?? "";
          break;
        }
        case "link":
          links.push(a);
          break;
        case "script":
          if (a.src) {
            scripts.push(a.src);
            const src = a.src.toLowerCase();
            if (customChat.length < 4 && CHAT_TOKEN_RE.test(src) && !FLOAT_WA_RE.test(src)) customChat.push(`script src="${a.src.slice(-40)}"`);
          } else inlineScripts += 1;
          break;
        case "img":
          imgs.push(a);
          break;
        case "form":
          forms += 1;
          break;
        case "input":
        case "textarea":
        case "select":
          formFields += 1;
          break;
        case "a":
          if (current) anchors.push(current); // an unclosed <a>: keep what we have
          current = { href: a.href ?? "", text: "", hreflang: a.hreflang ?? "", pos: bodyTags };
          break;
        case "title":
          inTitle = true;
          break;
        case "style":
          inStyle = true;
          break;
        case "h1":
        case "h2":
        case "h3":
          heading = { tag: name, text: "" };
          break;
      }
      if (SKIP.has(name)) skip += 1;

      if (customChat.length < 4 && CHAT_TAGS.has(name)) {
        const hit = chatSignal(name, a);
        if (hit) customChat.push(hit);
      }

      const style = a.style;
      if (style) {
        if (/direction\s*:\s*rtl/i.test(style)) inlineRtl += 1;
        if (/text-align\s*:\s*left/i.test(style)) inlineLeft += 1;
        if (/(?<![-\w])width\s*:\s*\d{4,}px/i.test(style)) inlineFixedWidth += 1;
      }
      if (!floatingWa && (FLOAT_WA_RE.test(a.class ?? "") || FLOAT_WA_RE.test(a.id ?? ""))) floatingWa = true;
    },

    onclosetag(name) {
      if (name === "style") inStyle = false;
      if (SKIP.has(name) && skip > 0) skip -= 1;
      if (name === "title") inTitle = false;
      if (name === "a" && current) {
        current.text = current.text.replace(/\s+/g, " ").trim();
        anchors.push(current);
        current = null;
      }
      if ((name === "h1" || name === "h2" || name === "h3") && heading) {
        const t = heading.text.replace(/\s+/g, " ").trim();
        if (t && headings.length < 12) headings.push({ tag: heading.tag, text: t.slice(0, 120) });
        heading = null;
      }
    },

    ontext(data) {
      if (inTitle) title += data;
      if (inStyle) styleText.push(data);
      if (skip > 0) return;
      text.push(data);
      if (current) current.text += data;
      if (heading) heading.text += data;
    },
  });

  parser.write(html);
  parser.end();
  if (current) anchors.push(current);

  const totalBodyTags = Math.max(bodyTags, 1);
  const visible = text.join(" ").replace(/\s+/g, " ").trim();
  const arabicChars = count(visible, AR_RE);
  const latinChars = count(visible, LATIN_RE);
  const arabicRatio = arabicChars + latinChars === 0 ? 0 : arabicChars / (arabicChars + latinChars);
  const lower = html.toLowerCase();

  // ---- language switch --------------------------------------------------------
  // A switch points to the OTHER language of the one this page is in.
  const arabicPage = arabicChars >= latinChars;
  const labels = arabicPage ? SWITCH_LABELS_FROM_AR : SWITCH_LABELS_FROM_EN;
  const otherPath = arabicPage ? /(^|\/|=)(en|english)(\/|$|\?|&)/ : /(^|\/|=)(ar|arabic)(\/|$|\?|&)/;
  const switchLinks = anchors
    .filter((a) => a.hreflang || labels.has(a.text.trim().toLowerCase()) || otherPath.test(a.href.toLowerCase()))
    .slice(0, 6)
    .map((a) => ({ text: a.text.slice(0, 30), href: a.href.slice(0, 100) }));

  // ---- punctuation ---------------------------------------------------------------
  const punct = [...visible.matchAll(LATIN_PUNCT_RE)];
  const latinPunctExamples = punct.slice(0, 4).map((m) => visible.slice(Math.max(0, (m.index ?? 0) - 15), (m.index ?? 0) + m[0].length + 10));

  // ---- contact -------------------------------------------------------------------
  const tel = anchors.filter((a) => a.href.toLowerCase().startsWith("tel:")).map((a) => a.href);
  const whatsapp = anchors.filter((a) => WA_RE.test(a.href)).map((a) => a.href);
  const mailto = anchors.filter((a) => a.href.toLowerCase().startsWith("mailto:")).map((a) => a.href.slice(7).split("?")[0]);
  const found = visible.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/g) ?? [];
  const emails = [...new Set([...mailto, ...found.filter((m) => !/\.(png|jpe?g|gif|webp|svg)$/i.test(m))])].slice(0, 6);
  const contactAnchors = anchors.filter((a) => a.href.toLowerCase().startsWith("tel:") || WA_RE.test(a.href) || (a.text && CTA_RE.test(a.text + " " + a.href)));
  const earliestContactPct = contactAnchors.length ? pct(Math.min(...contactAnchors.map((a) => a.pos)), totalBodyTags) : null;

  // ---- tech and age ----------------------------------------------------------------
  const chatWidgets = Object.entries(CHAT_SIGS).filter(([, sigs]) => sigs.some((s) => lower.includes(s))).map(([n]) => n);
  const platforms = Object.entries(TECH_SIGS).filter(([, sigs]) => sigs.some((s) => lower.includes(s))).map(([n]) => n);
  const jquery = [...new Set([...lower.matchAll(/jquery[-./]?(?:min\.)?v?(\d+\.\d+(?:\.\d+)?)/g)].map((m) => m[1]))].slice(0, 3);
  const bootstrap = [...new Set([...lower.matchAll(/bootstrap[-./@]v?(\d+\.\d+(?:\.\d+)?)/g)].map((m) => m[1]))].slice(0, 3);
  const copyrightText = [
    ...visible.matchAll(/(?:©|copyright|حقوق\s+(?:النشر|الطبع)|جميع\s+الحقوق)[^\n]{0,80}?(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)\d{2})?/gi),
  ].slice(0, 4).map((m) => m[0].slice(0, 100));
  const years = copyrightText.flatMap((c) => (c.match(/(?:19|20)\d{2}/g) ?? []).map(Number));

  // ---- inline CSS ---------------------------------------------------------------------
  const css = styleText.join("\n");

  // ---- assets this page pulls in ------------------------------------------------------
  const refs: PageFacts["assetRefs"] = [];
  const seen = new Set<string>();
  const addRef = (kind: PageFacts["assetRefs"][number]["kind"], href: string | undefined) => {
    if (!href || href.startsWith("data:")) return;
    const u = safeUrl(href, pageUrl);
    if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) return;
    u.hash = "";
    if (seen.has(u.toString())) return;
    seen.add(u.toString());
    refs.push({ kind, url: u.toString() });
  };
  for (const l of links) {
    const rel = (l.rel ?? "").toLowerCase();
    if (rel.includes("stylesheet")) addRef("css", l.href);
    else if (rel.includes("modulepreload")) addRef("script", l.href);
    else if (rel.includes("preload") && l.as === "font") addRef("font", l.href);
    else if (rel.includes("preload") && l.as === "script") addRef("script", l.href);
    else if (rel.includes("preload") && l.as === "style") addRef("css", l.href);
  }
  for (const s of scripts) addRef("script", s);
  for (const i of imgs) addRef("image", i.src || i["data-src"]);

  // ---- internal links (to choose which pages to read next) ----------------------------
  const host = bareHost(new URL(pageUrl).hostname);
  const internal: { url: string; text: string }[] = [];
  const ownPath = new URL(pageUrl).pathname.replace(/\/index\.(html?|php|aspx?)$/i, "/");
  const seenPaths = new Set<string>([ownPath]);
  for (const a of anchors) {
    if (!a.href || /^(#|mailto:|tel:|javascript:)/i.test(a.href)) continue;
    const u = safeUrl(a.href, pageUrl);
    if (!u || (u.protocol !== "http:" && u.protocol !== "https:") || bareHost(u.hostname) !== host) continue;
    u.hash = "";
    u.pathname = u.pathname.replace(/\/index\.(html?|php|aspx?)$/i, "/"); // /x/index.html is /x/
    if (u.pathname === "/" || u.pathname === "") continue;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4)$/i.test(u.pathname)) continue;
    if (seenPaths.has(u.pathname)) continue;
    seenPaths.add(u.pathname);
    internal.push({ url: u.toString(), text: a.text.slice(0, 40) });
  }

  const scriptCount = scripts.length + inlineScripts;
  const origin = new URL(pageUrl);

  return {
    url: pageUrl,
    status: meta.status,
    title: title.replace(/\s+/g, " ").trim().slice(0, 150),
    metaDescription: (metas["description"] ?? "").trim().slice(0, 300),
    htmlLang: htmlAttrs.lang || null,
    htmlDir: htmlAttrs.dir || null,
    bodyDir: bodyAttrs.dir || null,
    arabicChars,
    latinChars,
    arabicRatio: Math.round(arabicRatio * 100) / 100,
    switchLinks,
    hreflang: links.filter((l) => (l.rel ?? "").toLowerCase() === "alternate" && l.hreflang).map((l) => ({ lang: l.hreflang, href: l.href ?? "" })).slice(0, 6),
    latinPunctCount: punct.length,
    latinPunctExamples,
    arabicPunctCount: count(visible, ARABIC_PUNCT_RE),
    inlineRtl,
    inlineTextAlignLeft: inlineLeft,
    inlineMedia: count(css, /@media/g),
    inlineCssRtl: count(css, /direction\s*:\s*rtl|\[dir=["']?rtl|\.rtl\b/gi),
    viewport: metas["viewport"] ?? null,
    tables: counts["table"] ?? 0,
    fixedWidthInline: inlineFixedWidth,
    tel: tel.slice(0, 3),
    whatsapp: whatsapp.slice(0, 3),
    emails,
    forms,
    formFields,
    bookingHint: BOOKING_RE.test(lower),
    floatingWhatsapp: floatingWa,
    earliestContactPct,
    chatWidgets,
    customChat,
    platforms,
    jquery,
    bootstrap,
    oldTags: Object.fromEntries((["font", "center", "marquee", "frameset"] as const).filter((t) => counts[t]).map((t) => [t, counts[t]])),
    flash: lower.includes(".swf"),
    copyrightYear: years.length ? Math.max(...years) : null,
    copyrightText,
    images: imgs.length,
    imagesMissingAlt: imgs.filter((i) => !i.alt).length,
    // `loading="lazy"`, or a lazy-loading library's marker (data-src, class "lazy").
    imagesLazy: imgs.filter((i) => i.loading === "lazy" || i["data-src"] || i["data-lazy-src"] || /lazy/i.test(i.class ?? "")).length,
    scripts: scriptCount,
    stylesheets: refs.filter((r) => r.kind === "css").length,
    mixedContentRefs: origin.protocol === "https:" ? (lower.match(/(?:src|href)=["']http:\/\//g)?.length ?? 0) : 0,
    visibleChars: visible.length,
    textSample: visible.slice(0, 400),
    jsShell: visible.length < 300 && scriptCount > 3,
    headings,
    internalLinks: internal,
    assetRefs: refs,
    transferBytes: meta.transferBytes,
    fetchMs: meta.fetchMs,
    contentEncoding: meta.contentEncoding,
  };
}

/** From a homepage's internal links, the best guess for each of services / contact / about. */
export function pickKeyPages(links: { url: string; text: string }[]): Record<PageKind, string | null> {
  const out: Record<PageKind, string | null> = { services: null, contact: null, about: null };
  for (const l of links) {
    if (JUNK_PAGE.test(l.url)) continue;
    let path = l.url;
    try {
      path = decodeURIComponent(new URL(l.url).pathname);
    } catch {
      /* keep the raw URL */
    }
    const blob = `${path} ${l.text}`.toLowerCase();
    for (const kind of Object.keys(PAGE_KEYS) as PageKind[]) {
      if (!out[kind] && PAGE_KEYS[kind].some((k) => blob.includes(k))) out[kind] = l.url;
    }
  }
  return out;
}

/** What a stylesheet's text says about responsiveness and direction. */
export function analyzeCss(css: string): { media: number; rtl: number; fixedWidth: number } {
  return {
    media: count(css, /@media/g),
    rtl: count(css, /direction\s*:\s*rtl|\[dir=["']?rtl|\.rtl\b|rtl\.css/gi),
    // width / min-width of 1000px or more (max-width is fine and common, hence the lookbehind)
    fixedWidth: count(css, /(?<![-\w])(?:min-)?width\s*:\s*(?:1\d{3}|[2-9]\d{3})px/gi),
  };
}
