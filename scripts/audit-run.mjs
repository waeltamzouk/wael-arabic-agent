// Run the audit engine from the terminal. No website, no database, no email.
//
//   node scripts/audit-run.mjs example.com.sa
//   node scripts/audit-run.mjs example.com.sa --json
//   AUDIT_ALLOW_PRIVATE=1 node scripts/audit-run.mjs http://127.0.0.1:8765/good-ar/   (fake sites)
//
// It runs the same crawl + score the web page will run (lib/audit/*.ts). Node
// strips the TypeScript types itself, so there is nothing to build.

const target = process.argv[2];
const asJson = process.argv.includes("--json");
if (!target) {
  console.error("Usage: node scripts/audit-run.mjs <website> [--json]");
  process.exit(1);
}

const { crawlSite } = await import("../lib/audit/crawl.ts");
const { scoreAudit } = await import("../lib/audit/score.ts");

const started = Date.now();
const crawl = await crawlSite(target);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

if (!crawl.ok) {
  console.log(asJson ? JSON.stringify({ ok: false, ...crawl }) : `Could not audit: ${crawl.reason} (${crawl.detail}) in ${seconds}s`);
  process.exit(2);
}

const report = scoreAudit(crawl);
if (asJson) {
  console.log(JSON.stringify({ ok: true, seconds: Number(seconds), notes: crawl.notes, report }, null, 2));
} else {
  console.log(`\n${report.domain}  ->  ${report.score === null ? "NO SCORE" : report.score + "/100"}  (${report.grade ?? "-"})  in ${seconds}s  [${crawl.network.requestsMade} requests]`);
  console.log("categories:", report.categories.map((c) => `${c.id} ${c.score ?? "?"}/${c.max}`).join("  "));
  console.log("top 3:", report.top.join(", ") || "-");
  for (const f of report.findings) console.log(`  -${String(f.lost).padStart(2)}  ${f.id.padEnd(22)} ${JSON.stringify(f.params)}`);
  console.log("observations:", report.observations.map((o) => o.id + JSON.stringify(o.params)).join(" "));
  console.log("unverified:", report.unverified.join(", ") || "-", "| partial:", report.partial, "| ~MB", report.approxWeightMb, "| ~requests", report.requestsEstimated);
  console.log("pages:");
  for (const p of report.pages) console.log(`  ${String(p.status)} ${p.url.slice(0, 70).padEnd(70)} ar ${String(p.arabicShare).padStart(3)}%  lang ${p.langOk ? "ok" : "--"} dir ${p.dirOk ? "ok" : "--"} viewport ${p.viewportOk ? "ok" : "--"} contact ${p.hasDirectContact ? "ok" : "--"} ${p.kb}KB`);
}
