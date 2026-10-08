// A fetch that cannot be aimed at your own network.
//
// WHY THIS FILE EXISTS. The audit page lets a stranger type a web address, and
// then YOUR server opens it. Without care, "http://169.254.169.254" (the cloud
// provider's internal metadata service) or "http://localhost:3000" would be
// opened from inside Vercel, and the answer shown back. That attack is called
// SSRF. Every network call the audit makes goes through here.
//
// WHAT STOPS IT, in the order a request meets them:
//   1. assertSafeUrl   — scheme, port, credentials, length, and IP-literal hosts
//   2. guardedLookup   — checks the address the name RESOLVES to, at connect
//                        time. Checking the name first and connecting later is
//                        the classic hole ("DNS rebinding"): the name answers
//                        with a public address for the check and a private one
//                        for the connection. Here the check IS the connection.
//   3. manual redirects — each hop goes back through 1 and 2
//   4. caps            — time, bytes (also after decompression), request count
//
// Node's `fetch` is NOT used on purpose: it cannot be given a custom lookup
// without extra packages. `node:http(s)` can, and needs nothing installed.
//
// Written to also run under plain `node` (type stripping): no enums, no
// parameter properties, and relative imports carry their `.ts` extension.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import type { TLSSocket } from "node:tls";

export const AUDIT_UA = "WaelWebDesign-SiteAudit/1.0 (+https://waelwebdesign.com)";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Dev only. Lets tests reach fake sites on localhost. Ignored in production, always. */
export function allowPrivate(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AUDIT_ALLOW_PRIVATE === "1";
}

// ---------------------------------------------------------------------------
// 1. Which addresses are off limits
// ---------------------------------------------------------------------------

const blocked = new net.BlockList();
const V4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including the cloud metadata address
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24],
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and the broadcast address
];
const V6: [string, number][] = [
  ["::", 96], // unspecified, loopback and the old IPv4-compatible range
  // NOT listed: ::ffff:0:0/96 (IPv4 written as IPv6). Node's BlockList treats every
  // IPv4 address as living inside that range, so listing it blocked the whole
  // internet. Mapped addresses are caught anyway: check("::ffff:7f00:1") is tested
  // against the IPv4 rules above. Found by the "normal sites must work" test.
  ["64:ff9b::", 96], // NAT64: embeds an IPv4 address
  ["100::", 64],
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4: embeds an IPv4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];
for (const [address, prefix] of V4) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of V6) blocked.addSubnet(address, prefix, "ipv6");

export function isPrivateAddress(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, "").split("%")[0];
  if (net.isIPv4(ip)) return blocked.check(ip, "ipv4");
  if (net.isIPv6(ip)) return blocked.check(ip, "ipv6");
  return true; // not an IP at all: refuse rather than guess
}

const BAD_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".intranet"];

/** Throws UnsafeUrlError unless this is a plain public http(s) address. */
export function assertSafeUrl(raw: string): URL {
  if (raw.length > 2000) throw new UnsafeUrlError("address too long");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("not a valid address");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`scheme ${url.protocol} not allowed`);
  }
  if (url.username || url.password) throw new UnsafeUrlError("credentials in address");

  const dev = allowPrivate();
  if (!dev && url.port !== "" && url.port !== "80" && url.port !== "443") {
    throw new UnsafeUrlError(`port ${url.port} not allowed`);
  }

  // URL() has already turned 2130706433, 0x7f.1 and 017700000001 into 127.0.0.1,
  // so this one check covers all of those spellings.
  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (!dev && isPrivateAddress(host)) throw new UnsafeUrlError("private address");
  } else if (!dev) {
    if (host === "localhost" || BAD_SUFFIXES.some((s) => host.endsWith(s))) {
      throw new UnsafeUrlError("internal hostname");
    }
    if (!host.includes(".")) throw new UnsafeUrlError("single-label hostname");
  }
  return url;
}

/** What a visitor typed ("example.com.sa", " https://x.sa/ ") -> an address we can fetch. */
export function normalizeUserUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) throw new UnsafeUrlError("not a valid address");
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** example.com for https://www.Example.com/path. The key for "one audit per site per day". */
export function domainOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

// ---------------------------------------------------------------------------
// 2. The guard at connect time
// ---------------------------------------------------------------------------

const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0) return callback(new Error("no address for host"), "", 4);
    // ANY private answer refuses the host. Picking only the public ones would let
    // a name that answers with both slip through whenever the OS picks the wrong one.
    if (!allowPrivate() && list.some((a) => isPrivateAddress(a.address))) {
      return callback(new UnsafeUrlError("host resolves to a private address"), "", 4);
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
};

// ---------------------------------------------------------------------------
// 3. One request, with caps
// ---------------------------------------------------------------------------

export type FetchContext = {
  /** Date.now() value after which nothing more is fetched. */
  deadline: number;
  /** Requests left for the whole audit, redirects included. Shared by reference. */
  budget: { left: number };
};

export type FetchOptions = {
  method?: "GET" | "HEAD";
  maxBytes?: number;
  timeoutMs?: number;
  acceptLanguage?: string;
  range?: string;
  /** 0 = report the 3xx itself instead of following it. */
  maxRedirects?: number;
  /** Return as soon as the headers arrive and drop the body. For reading a size or a status. */
  headersOnly?: boolean;
  ctx?: FetchContext;
};

export type Hop = { from: string; to: string; status: number };

export type FetchResult = {
  url: string;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  /** Bytes on the wire, i.e. after compression. */
  wireBytes: number;
  truncated: boolean;
  ms: number;
  hops: Hop[];
  tls?: { error?: string; daysLeft: number | null };
};

type HopResult = Omit<FetchResult, "url" | "hops" | "tls"> & { cert?: { daysLeft: number | null } };

const CERT_ERRORS = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_UNTRUSTED",
]);

function fetchHop(
  url: URL,
  o: { method: "GET" | "HEAD"; maxBytes: number; timeoutMs: number; acceptLanguage: string; range?: string; headersOnly: boolean; insecureTls: boolean }
): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const started = Date.now();
    let settled = false;
    let timedOut = false;

    const finish = (error: Error | null, value?: HopResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value as HopResult);
    };

    const options: https.RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ""),
      port: url.port || undefined,
      path: url.pathname + url.search,
      method: o.method,
      // A fresh agent per request: no shared sockets, no keep-alive, nothing reused
      // between audits that could carry state from one stranger's site to another.
      agent: false,
      lookup: guardedLookup,
      headers: {
        "User-Agent": AUDIT_UA,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": o.acceptLanguage,
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "close",
        ...(o.range ? { Range: o.range } : {}),
      },
      ...(isHttps ? { rejectUnauthorized: !o.insecureTls } : {}),
    };

    const req = (isHttps ? https : http).request(options, (res) => {
      const status = res.statusCode ?? 0;
      const headers = res.headers;
      let cert: HopResult["cert"];
      if (isHttps) {
        try {
          const valid = (res.socket as TLSSocket).getPeerCertificate().valid_to;
          const left = valid ? Math.floor((new Date(valid).getTime() - Date.now()) / 86_400_000) : null;
          cert = { daysLeft: Number.isFinite(left) ? left : null };
        } catch {
          cert = { daysLeft: null };
        }
      }

      const empty = (truncated = false): HopResult => ({
        status, headers, body: Buffer.alloc(0), wireBytes: 0, truncated, ms: Date.now() - started, cert,
      });

      // A redirect's body is never wanted, and neither is a HEAD's or a size probe's.
      if (o.method === "HEAD" || o.headersOnly || (status >= 300 && status < 400)) {
        res.destroy();
        return finish(null, empty());
      }

      const encoding = String(headers["content-encoding"] ?? "").toLowerCase();
      let out: Readable = res;
      if (encoding === "gzip" || encoding === "x-gzip") out = res.pipe(zlib.createGunzip());
      else if (encoding === "deflate") out = res.pipe(zlib.createInflate());
      else if (encoding === "br") out = res.pipe(zlib.createBrotliDecompress());

      const chunks: Buffer[] = [];
      let got = 0;
      let wire = 0;
      let truncated = false;

      const done = () =>
        finish(null, {
          status, headers, body: Buffer.concat(chunks), wireBytes: wire,
          truncated: truncated || timedOut, ms: Date.now() - started, cert,
        });

      res.on("data", (chunk: Buffer) => {
        wire += chunk.length;
      });
      out.on("data", (chunk: Buffer) => {
        // The cap applies AFTER decompression, which is what stops a tiny
        // gzip file that unpacks to gigabytes.
        if (got + chunk.length > o.maxBytes) {
          chunks.push(chunk.subarray(0, o.maxBytes - got));
          got = o.maxBytes;
          truncated = true;
          res.destroy();
          out.destroy();
          return done();
        }
        chunks.push(chunk);
        got += chunk.length;
      });
      // WAIT FOR THE DECOMPRESSOR, not just the socket. The socket can close while
      // gzip/brotli is still unpacking its last chunk, and finishing on `res`
      // close returned an EMPTY body for small pages (found on example.com).
      out.on("end", done);
      out.on("close", done);
      out.on("error", done); // a broken stream still gives us what arrived
      res.on("error", () => out.destroy()); // aborted or timed out: closing `out` runs done()
      res.on("close", () => {
        if (out === res) done(); // no decompressor in the way
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      req.destroy(new Error("timeout"));
    }, o.timeoutMs);

    req.on("error", (error) => finish(error));
    req.end();
  });
}

function remainingMs(ctx?: FetchContext): number {
  return ctx ? ctx.deadline - Date.now() : Number.POSITIVE_INFINITY;
}

function spend(ctx?: FetchContext) {
  if (!ctx) return;
  if (remainingMs(ctx) <= 0) throw new Error("audit time budget used up");
  if (ctx.budget.left <= 0) throw new Error("audit request budget used up");
  ctx.budget.left -= 1;
}

/**
 * Fetch one public address. Follows up to `maxRedirects` redirects by hand,
 * re-checking every hop. Throws UnsafeUrlError for anything off limits, and an
 * ordinary Error (ENOTFOUND, ECONNREFUSED, "timeout" ...) for a site that is
 * simply down.
 */
export async function safeFetch(rawUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
  let url = assertSafeUrl(rawUrl);
  const hops: Hop[] = [];
  const maxRedirects = opts.maxRedirects ?? 5;
  let insecureTls = false;
  let tlsError: string | undefined;

  for (;;) {
    spend(opts.ctx);
    const timeoutMs = Math.max(500, Math.min(opts.timeoutMs ?? 8000, remainingMs(opts.ctx)));

    let result: HopResult;
    try {
      result = await fetchHop(url, {
        method: opts.method ?? "GET",
        maxBytes: opts.maxBytes ?? 2_000_000,
        timeoutMs,
        acceptLanguage: opts.acceptLanguage ?? "ar-SA,ar;q=0.9,en;q=0.5",
        range: opts.range,
        headersOnly: opts.headersOnly ?? false,
        insecureTls,
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      // A bad certificate is a FINDING about the site, not a reason to give up:
      // read the page anyway (still through the guarded lookup) and remember why.
      if (url.protocol === "https:" && !insecureTls && CERT_ERRORS.has(code)) {
        insecureTls = true;
        tlsError = code;
        continue;
      }
      throw error;
    }

    const location = result.headers.location;
    if (result.status >= 300 && result.status < 400 && location && hops.length < maxRedirects) {
      const next = assertSafeUrl(new URL(location, url).toString());
      hops.push({ from: url.toString(), to: next.toString(), status: result.status });
      url = next;
      continue;
    }

    return {
      url: url.toString(),
      status: result.status,
      headers: result.headers,
      body: result.body,
      wireBytes: result.wireBytes,
      truncated: result.truncated,
      ms: result.ms,
      hops,
      tls: url.protocol === "https:" ? { error: tlsError, daysLeft: result.cert?.daysLeft ?? null } : undefined,
    };
  }
}

/**
 * How big is this file? One request, never the whole download when it can be
 * avoided: ask for the first byte and read the total from `Content-Range`;
 * failing that, trust `Content-Length`; failing that, count the download up to a
 * cap. Returns null when the server will not say and will not be counted.
 *
 * Note this is the size of the file itself, which for scripts and styles is
 * larger than what crosses the wire compressed. The report treats weight as a
 * rough signal for that reason.
 */
const SIZE_CAP = 1_500_000;

export async function probeSize(rawUrl: string, ctx?: FetchContext): Promise<number | null> {
  try {
    const first = await safeFetch(rawUrl, { range: "bytes=0-0", headersOnly: true, maxRedirects: 3, timeoutMs: 6000, ctx });
    const total = /\/(\d+)\s*$/.exec(String(first.headers["content-range"] ?? ""));
    if (first.status === 206 && total) return Number(total[1]);
    const length = Number(first.headers["content-length"]);
    if (first.status === 200 && Number.isFinite(length) && length > 0) return length;
    // The server ignored Range and does not say how long the file is (chunked).
    // Many image CDNs do exactly this. Count it, up to a cap: past the cap the
    // answer is "at least this much".
    if (first.status === 200 || first.status === 206) {
      const whole = await safeFetch(rawUrl, { maxBytes: SIZE_CAP, maxRedirects: 3, timeoutMs: 8000, ctx });
      if (whole.status === 200) return whole.truncated ? SIZE_CAP : whole.body.length;
    }
    return null;
  } catch {
    return null;
  }
}
