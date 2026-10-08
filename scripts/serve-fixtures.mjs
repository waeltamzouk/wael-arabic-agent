// Fake websites for testing the audit engine, served on http://127.0.0.1:8765
//
//   /good-ar/       a well-built Arabic clinic site (4 pages)
//   /bad-clinic/    an English page with an Arabic banner, no mobile tag, old libraries
//   /js-shell/      an empty page that JavaScript would fill in
// and one route for each way a real site can misbehave:
//   /huge           a 60 MB page          /slow       no answer for 30 s
//   /slowbody       answers, then drips   /loop       redirects to itself
//   /pdf            not a web page        /bomb       a tiny gzip that unpacks to 300 MB
//   /win1256        Arabic in the old windows-1256 encoding
//   /notfound       404                   /redirect   301 -> /good-ar/
//
// Run:   node scripts/serve-fixtures.mjs
// Then:  AUDIT_ALLOW_PRIVATE=1 node scripts/audit-run.mjs http://127.0.0.1:8765/good-ar/
//
// The audit refuses localhost in production (that is the whole point of
// lib/audit/safe-fetch.ts). AUDIT_ALLOW_PRIVATE=1 is a dev-only switch that the
// code ignores when NODE_ENV=production.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "audit-fixtures");
const PORT = Number(process.env.PORT || 8765);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".js": "text/javascript" };

// "مرحبا بكم في موقعنا" in windows-1256, byte by byte (Node has no encoder for it).
const WIN1256 = Buffer.from([
  0xe3, 0xd1, 0xcd, 0xc8, 0xc7, 0x20, 0xc8, 0xdf, 0xe3, 0x20, 0xdd, 0xed, 0x20, 0xe3, 0xe6, 0xdb, 0xdd, 0xc7,
]);

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (p === "/huge") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.write("<html><body>");
    let sent = 0;
    const pump = () => {
      while (sent < 60_000_000) {
        const ok = res.write("<p>filler filler filler filler filler filler filler</p>".repeat(2000));
        sent += 104_000;
        if (!ok) return res.once("drain", pump);
      }
      res.end("</body></html>");
    };
    return pump();
  }
  if (p === "/slow") return void setTimeout(() => res.end("late"), 30_000);
  if (p === "/slowbody") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.write("<html><body>hello");
    const t = setInterval(() => res.write(" ."), 1000);
    return void res.on("close", () => clearInterval(t));
  }
  if (p === "/loop") return void res.writeHead(302, { Location: "/loop" }).end();
  if (p === "/redirect") return void res.writeHead(301, { Location: "/good-ar/" }).end();
  if (p === "/pdf") return void res.writeHead(200, { "Content-Type": "application/pdf" }).end("%PDF-1.4 not a web page");
  if (p === "/notfound") return void res.writeHead(404, { "Content-Type": "text/html" }).end("<h1>404</h1>");
  if (p === "/bomb") {
    // 300 MB of zeros compresses to ~300 KB. The engine must stop unpacking at its cap.
    const zip = zlib.gzipSync(Buffer.alloc(300_000_000, 0x20), { level: 9 });
    return void res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" }).end(zip);
  }
  if (p === "/win1256") {
    const html = Buffer.concat([
      Buffer.from('<!doctype html><html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1256"><title>t</title></head><body><p>'),
      ...Array.from({ length: 12 }, () => Buffer.concat([WIN1256, Buffer.from(" ")])),
      Buffer.from("</p></body></html>"),
    ]);
    return void res.writeHead(200, { "Content-Type": "text/html" }).end(html);
  }

  // Static folders: "/good-ar/" -> audit-fixtures/good-ar/index.html
  let rel = normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, "");
  if (rel.endsWith("/") || rel === "") rel = join(rel, "index.html");
  try {
    const file = await readFile(join(ROOT, rel));
    res.writeHead(200, { "Content-Type": TYPES[extname(rel)] || "application/octet-stream" }).end(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/html" }).end("<h1>404</h1>");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`fixtures on http://127.0.0.1:${PORT}`));
