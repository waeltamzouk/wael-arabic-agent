// Take test traffic out of the funnel counters.
//
// The counters (lib/stats.ts) are plain numbers in Upstash: one key per day and
// per metric (`chat:2026-10-03:started`), plus an all-time total per metric
// (`chat:total:started`). Every test conversation you typed while building the
// agent is in there, and nothing in the app can tell it from a real visitor.
//
// THIS SCRIPT DOES NOTHING UNTIL YOU ADD --yes. Without it, it only prints what
// it WOULD delete, day by day, so you can see which days were tests.
//
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
//     node scripts/reset-counters.mjs --from 2026-09-22 --to 2026-10-08
//
//   --from / --to   first and last day to clear, inclusive (Riyadh dates)
//   --site          waelwebdesign | templates | whatsapp   (default: all three)
//   --all           clear EVERY day and the all-time totals (instead of dates)
//   --yes           actually delete
//
// Only keys that start with `chat:` are ever touched, and the Polar buyer
// counters (`buyer_*`, `polar_refused`) are always left alone: they are real
// orders, not chat tests. Nothing in this file is secret — the URL and token
// come from your environment, never from the repo.

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const from = value("from");
const to = value("to");
const site = value("site") ?? "all";
const all = flag("all");
const yes = flag("yes");

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!all && !(from && to)) {
  fail("Say which days: --from YYYY-MM-DD --to YYYY-MM-DD (or --all to clear everything).");
}
if (!all && (!DAY.test(from) || !DAY.test(to) || from > to)) {
  fail("--from and --to must be dates like 2026-10-08, and --from cannot be after --to.");
}
if (!["all", "waelwebdesign", "templates", "whatsapp"].includes(site)) {
  fail("--site must be waelwebdesign, templates, whatsapp or all.");
}

const rawUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
if (!rawUrl || !token) {
  fail("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (the REST ones, from the Upstash dashboard).");
}
const url = (/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`).replace(/\/+$/, "");

async function pipeline(commands) {
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) fail(`Upstash answered ${res.status}. Check the URL and token.`);
  const body = await res.json();
  for (const entry of body) if (entry.error) fail(`Upstash error: ${entry.error}`);
  return body.map((entry) => entry.result);
}

/** Which site's funnel a stored metric name belongs to, or null if it is not a chat counter. */
function siteOf(metric) {
  if (metric.startsWith("buyer_") || metric === "polar_refused") return null;
  if (metric.startsWith("whatsapp_")) return "whatsapp";
  if (metric.startsWith("templates_")) return "templates";
  return "waelwebdesign";
}

const wanted = (metric) => {
  const owner = siteOf(metric);
  return owner !== null && (site === "all" || site === owner);
};

// ---- find every chat counter ------------------------------------------------
const keys = [];
let cursor = "0";
do {
  const [[next, batch]] = await pipeline([["SCAN", cursor, "MATCH", "chat:*", "COUNT", "500"]]);
  cursor = String(next);
  keys.push(...batch);
} while (cursor !== "0");

const daily = [];
const totals = [];
for (const key of keys) {
  const parts = key.split(":"); // chat:<day>:<metric> or chat:total:<metric>
  if (parts.length < 3) continue;
  const metric = parts.slice(2).join(":");
  if (!wanted(metric)) continue;
  if (parts[1] === "total") totals.push({ key, metric });
  else if (DAY.test(parts[1]) && (all || (parts[1] >= from && parts[1] <= to))) {
    daily.push({ key, day: parts[1], metric });
  }
}

const dailyValues = daily.length ? await pipeline(daily.map((d) => ["GET", d.key])) : [];
daily.forEach((d, i) => (d.value = Number(dailyValues[i] ?? 0)));

// ---- show what would go -----------------------------------------------------
const perDay = new Map();
for (const d of daily) {
  const row = perDay.get(d.day) ?? { started: 0, other: 0 };
  if (d.metric === "started" || d.metric.endsWith("_started")) row.started += d.value;
  else row.other += d.value;
  perDay.set(d.day, row);
}

console.log(`\n${yes ? "DELETING" : "DRY RUN — nothing will be deleted"}`);
console.log(`Site: ${site}   Days: ${all ? "ALL" : `${from} to ${to}`}\n`);
console.log("Day          Conversations started   Other counters");
for (const day of [...perDay.keys()].sort()) {
  const row = perDay.get(day);
  console.log(`${day}   ${String(row.started).padStart(10)}            ${String(row.other).padStart(8)}`);
}
console.log(`\n${daily.length} daily counters${all ? ` and ${totals.length} all-time totals` : ""} selected.`);

if (!yes) {
  console.log("\nLooks right? Run the same command again with --yes added.\n");
  process.exit(0);
}

// ---- delete ----------------------------------------------------------------
if (all) {
  const doomed = [...daily.map((d) => d.key), ...totals.map((t) => t.key)];
  for (let i = 0; i < doomed.length; i += 200) {
    await pipeline([["DEL", ...doomed.slice(i, i + 200)]]);
  }
} else {
  // The all-time totals must come down by exactly what the days held, or /stats
  // would still count the tests. Floored at zero.
  const removed = new Map();
  for (const d of daily) removed.set(d.metric, (removed.get(d.metric) ?? 0) + d.value);

  const metrics = [...removed.keys()];
  const current = metrics.length
    ? await pipeline(metrics.map((m) => ["GET", `chat:total:${m}`]))
    : [];
  const writes = [];
  metrics.forEach((m, i) => {
    if (current[i] === null || current[i] === undefined) return;
    writes.push(["SET", `chat:total:${m}`, String(Math.max(0, Number(current[i]) - removed.get(m)))]);
  });
  if (writes.length) await pipeline(writes);

  for (let i = 0; i < daily.length; i += 200) {
    await pipeline([["DEL", ...daily.slice(i, i + 200).map((d) => d.key)]]);
  }
}

console.log("\nDone. Reload /stats and the client dashboard.\n");
