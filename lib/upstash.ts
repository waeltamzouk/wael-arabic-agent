// The one connection to Upstash Redis, shared by the funnel counters
// (`lib/stats.ts`) and the WhatsApp conversation memory (`lib/whatsapp-memory.ts`).
// Moved out of lib/stats.ts in W8-T2 so there is still exactly ONE place that
// reads the URL and token and ONE place that turns a failure into words.
//
// NO dependency, same as before: Upstash has a plain REST API and `fetch` is
// enough.

// Normalised, because the value gets copied out of a dashboard by hand and the
// three ways it usually arrives wrong all produce the same unhelpful failure:
// a trailing slash (which makes the request path "//pipeline"), and a bare
// host with no scheme (which makes `fetch` throw on an invalid URL).
function restUrl(): string | undefined {
  const raw = process.env.UPSTASH_REDIS_REST_URL?.trim();
  if (!raw) return undefined;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

const REST_URL = restUrl();
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

export function upstashEnabled(): boolean {
  return Boolean(REST_URL && REST_TOKEN);
}

export class UpstashError extends Error {
  constructor(readonly status: number) {
    super(`Upstash request failed with ${status}`);
    this.name = "UpstashError";
  }
}

/** What a given failure most likely means, in words Wael can act on. */
export function upstashHint(error: unknown): string {
  const status = error instanceof UpstashError ? error.status : 0;
  if (status === 401 || status === 403) {
    return "Upstash rejected the token. UPSTASH_REDIS_REST_TOKEN is probably wrong — copy the REST token again, not the database password.";
  }
  if (status === 404) {
    return "Upstash did not recognise that address. UPSTASH_REDIS_REST_URL should be the REST URL from the dashboard, the https:// one — not the redis:// connection string.";
  }
  if (status) return `Upstash answered ${status}.`;
  return "Could not reach Upstash at all. Check UPSTASH_REDIS_REST_URL is the https:// REST URL from the dashboard.";
}

export async function pipeline(commands: unknown[][]): Promise<unknown[]> {
  const res = await fetch(`${REST_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });

  if (!res.ok) {
    // The body can echo back request details, so it goes to the server log and
    // never to the page. Only the status travels, which is what identifies the
    // problem anyway: 401 is a bad token, 404 a bad URL.
    console.error(`Upstash ${res.status}:`, await res.text());
    throw new UpstashError(res.status);
  }

  // A pipeline can return 200 with per-command errors, so a failed counter
  // would otherwise vanish silently. Log them; still return what did work.
  const body: { result?: unknown; error?: string }[] = await res.json();

  for (const entry of body) {
    if (entry.error) console.error("Upstash command failed:", entry.error);
  }

  return body.map((entry) => entry.result ?? null);
}
