// Which site a request or a chat panel belongs to. Deliberately its OWN file
// with no prompt in it: the chat widget runs in the browser and imports this,
// and importing lib/prompts there would ship the whole system prompt to every
// visitor.
//
// Two sites, two catalogues, one deployment — see "The two sites are
// SEPARATE" in CLAUDE.md.
export const SITES = ["waelwebdesign", "templates"] as const;

export type Site = (typeof SITES)[number];

export const DEFAULT_SITE: Site = "waelwebdesign";

export function isSite(value: unknown): value is Site {
  return SITES.includes(value as Site);
}

/**
 * The site named by a `?site=` query value. ALWAYS returns a site, never null
 * and never throws.
 *
 * Missing means the Arabic site — that is every request the waelwebdesign.com
 * bubble has ever sent, and it must keep working without a new Framer paste.
 * Case and stray spaces are forgiven (`Templates`, ` templates`), because a
 * hand-typed paste in Framer is exactly where those come from, and falling back
 * on them would hand the English site the Arabic prompt.
 *
 * Anything still unknown ALSO falls back to the Arabic site (W7-T3, Sep 24 —
 * this reverses W7-T1, which refused it with a 404/400). A visitor must always
 * get a working agent. The cost is that a typo is no longer loud, so it is
 * logged as `[site] unknown …` — grep the Vercel logs for that.
 */
export function siteFromParam(value: string | null | undefined): Site {
  const cleaned = (value ?? "").trim().toLowerCase();
  if (cleaned === "") return DEFAULT_SITE;
  if (isSite(cleaned)) return cleaned;
  console.warn(
    `[site] unknown site ${JSON.stringify((value ?? "").slice(0, 40))}, using ${DEFAULT_SITE}`
  );
  return DEFAULT_SITE;
}

/**
 * A funnel counter's name for this site. The Arabic site keeps its bare names,
 * so its history and the /stats page are untouched; every other site gets its
 * own prefixed keys and can never inflate the Arabic funnel.
 */
export function siteMetric(site: Site, name: string): string {
  return site === DEFAULT_SITE ? name : `${site}_${name}`;
}
