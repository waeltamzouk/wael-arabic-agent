import { SYSTEM_PROMPT as AR_WAELWEBDESIGN } from "./ar-waelwebdesign";
import { SYSTEM_PROMPT as EN_TEMPLATES } from "./en-templates";

// Two sites, two catalogues, one deployment. The prompt is the ONLY thing that
// differs between them — see "The two sites are SEPARATE" in CLAUDE.md.
export type Site = "waelwebdesign" | "templates";

export const DEFAULT_SITE: Site = "waelwebdesign";

const PROMPTS: Record<Site, string> = {
  waelwebdesign: AR_WAELWEBDESIGN,
  templates: EN_TEMPLATES,
};

export function isSite(value: unknown): value is Site {
  return typeof value === "string" && Object.hasOwn(PROMPTS, value);
}

// Returns the same string object every time, so each site's cached prefix
// stays byte-identical between requests.
export function promptFor(site: Site): string {
  return PROMPTS[site];
}
