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
 * The site named by a `?site=` query value. Missing means the Arabic site —
 * that is every request the waelwebdesign.com bubble has ever sent, and it
 * must keep working without a new Framer paste. Anything else unknown is
 * null, so the caller can refuse it instead of silently answering as Arabic.
 */
export function siteFromParam(value: string | null | undefined): Site | null {
  if (value == null || value === "") return DEFAULT_SITE;
  return isSite(value) ? value : null;
}

/**
 * A funnel counter's name for this site. The Arabic site keeps its bare names,
 * so its history and the /stats page are untouched; every other site gets its
 * own prefixed keys and can never inflate the Arabic funnel.
 */
export function siteMetric(site: Site, name: string): string {
  return site === DEFAULT_SITE ? name : `${site}_${name}`;
}
