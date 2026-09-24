import type { Site } from "@/lib/site";
import { SYSTEM_PROMPT as AR_WAELWEBDESIGN } from "./ar-waelwebdesign";
import {
  DIRECTIVES as EN_TEMPLATES_DIRECTIVES,
  SYSTEM_PROMPT as EN_TEMPLATES,
} from "./en-templates";

// SERVER ONLY. Never import this from a client component — see lib/site.ts.

export { EN_TEMPLATES_DIRECTIVES };

const PROMPTS: Record<Site, string> = {
  waelwebdesign: AR_WAELWEBDESIGN,
  templates: EN_TEMPLATES,
};

// Returns the same string object every time, so each site's cached prefix
// stays byte-identical between requests.
export function promptFor(site: Site): string {
  return PROMPTS[site];
}
