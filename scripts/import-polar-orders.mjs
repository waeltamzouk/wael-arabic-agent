// One-off: put the buyers who bought BEFORE the webhook existed onto the lists.
//
// The webhook only ever sees NEW orders, so the people already in the Polar
// dashboard would sit there unused forever — which was the entire reason this
// feature was built. This closes that gap once.
//
// It reads a CSV exported from Polar (Sales → Orders → export) rather than
// calling Polar's API, so there is no API token to create, store, or leak.
//
// It reuses the SAME rules as the live webhook: route by the product name's
// script, skip anyone unsubscribed, never touch an existing contact, and write
// the language/template/source properties. So a buyer imported here is
// indistinguishable from one the webhook added.
//
//   node scripts/import-polar-orders.mjs orders.csv          # dry run
//   node scripts/import-polar-orders.mjs orders.csv --write  # actually write
//
// DRY RUN IS THE DEFAULT on purpose: this writes to a real mailing list, and
// "what would it do" is the question you want answered first.

import { readFileSync } from "node:fs";
import { Resend } from "resend";

const [, , file, ...flags] = process.argv;
const WRITE = flags.includes("--write");

if (!file) {
  console.error("usage: node scripts/import-polar-orders.mjs <orders.csv> [--write]");
  process.exit(1);
}

// .env.local is not loaded automatically outside Next.js.
const ENV = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const resend = new Resend(ENV.RESEND_API_KEY);
const LISTS = { ar: ENV.RESEND_AUDIENCE_ID, en: ENV.RESEND_AUDIENCE_ID_EN };

if (!LISTS.ar || !LISTS.en) {
  console.error("RESEND_AUDIENCE_ID and RESEND_AUDIENCE_ID_EN must both be set in .env.local.");
  process.exit(1);
}

// A real CSV parser, not a split on commas: product names contain commas and
// Polar quotes them, so splitting naively puts half a template name in the
// email column and silently imports garbage.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

// Polar's export column names have changed before, so match on what the header
// CONTAINS rather than on an exact string. Better to find the column under a
// slightly different name than to import nothing and look like it worked.
function findColumn(header, ...candidates) {
  for (const want of candidates) {
    const i = header.findIndex((h) => h.trim().toLowerCase() === want);
    if (i !== -1) return i;
  }
  for (const want of candidates) {
    const i = header.findIndex((h) => h.trim().toLowerCase().includes(want));
    if (i !== -1) return i;
  }
  return -1;
}

// Identical to `audienceFor` in lib/polar-webhook.ts. Kept in step by hand
// because this script runs once; if they ever disagree, the webhook wins.
function listFor(product = "") {
  const arabic = (product.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (product.match(/[A-Za-z]/g) ?? []).length;
  return latin > arabic ? "en" : "ar";
}

const rows = parseCsv(readFileSync(file, "utf8"));
const header = rows.shift();

const cEmail = findColumn(header, "email");
const cProduct = findColumn(header, "product");
const cName = findColumn(header, "customer_name", "customer name", "billing_name", "name");
const cStatus = findColumn(header, "status");

if (cEmail === -1) {
  console.error("No email column found. Header was:", header.join(" | "));
  process.exit(1);
}

console.log(`columns -> email:${header[cEmail]} product:${header[cProduct] ?? "(none)"} name:${header[cName] ?? "(none)"} status:${header[cStatus] ?? "(none)"}`);
console.log(WRITE ? "\nWRITING to the lists.\n" : "\nDRY RUN — nothing will be written. Add --write when the plan below looks right.\n");

// One person, one entry PER LIST — not one entry per person.
//
// Someone who bought an Arabic template AND an English one belongs on both
// lists, because the live webhook puts them on both. Collapsing them to a
// single row here would quietly drop them from one catalogue's announcements,
// and the import would disagree with the webhook for the same buyer.
//
// Polar exports newest-first, so the FIRST row seen for an (email, list) pair
// is their most recent purchase from that catalogue — which is the more useful
// value for the `template` property than their oldest.
const buyers = new Map();   // key: `${email}\u0000${list}`
let skippedUnpaid = 0;

for (const row of rows) {
  const email = (row[cEmail] ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) continue;

  const status = (row[cStatus] ?? "paid").trim().toLowerCase();
  if (cStatus !== -1 && status && status !== "paid") { skippedUnpaid++; continue; }

  const product = (row[cProduct] ?? "").trim();
  const list = listFor(product);
  const key = `${email}\u0000${list}`;

  if (!buyers.has(key)) {
    buyers.set(key, { email, list, product, name: (row[cName] ?? "").trim() });
  }
}

const people = new Set([...buyers.values()].map((b) => b.email));
const bothLists = [...people].filter(
  (e) => buyers.has(`${e}\u0000ar`) && buyers.has(`${e}\u0000en`)
);

console.log(`${rows.length} order rows -> ${people.size} unique paid buyers -> ${buyers.size} list memberships` +
  (skippedUnpaid ? ` (${skippedUnpaid} unpaid rows skipped)` : ""));
if (bothLists.length) {
  console.log(`${bothLists.length} of them bought from BOTH catalogues and belong on both lists: ${bothLists.join(", ")}`);
}

const tally = { added: 0, already: 0, unsubscribed: 0, failed: 0 };

for (const buyer of buyers.values()) {
  const { list } = buyer;
  const audienceId = LISTS[list];

  try {
    // Account-level lookup FIRST — the same rule as lib/mailing-list.ts. A
    // contact can be unsubscribed account-wide and absent from this segment,
    // and an audience-scoped lookup answers "not found" for them. Creating on
    // that answer resubscribes someone who opted out.
    const existing = await resend.contacts.get({ email: buyer.email });

    if (existing.data?.unsubscribed) {
      console.log(`  unsub  ${buyer.email.padEnd(34)} left alone`);
      tally.unsubscribed++;
      continue;
    }

    if (existing.data) {
      const inList = await resend.contacts.get({ email: buyer.email, audienceId });
      if (inList.data) {
        console.log(`  have   ${buyer.email.padEnd(34)} already on the ${list} list`);
        tally.already++;
        continue;
      }
    }

    if (!WRITE) {
      console.log(`  WOULD  ${buyer.email.padEnd(34)} -> ${list} list  (${buyer.product || "unknown product"})`);
      tally.added++;
      continue;
    }

    const parts = buyer.name.split(/\s+/).filter(Boolean);
    const created = await resend.contacts.create({
      audienceId,
      email: buyer.email,
      firstName: parts[0],
      lastName: parts.slice(1).join(" ") || undefined,
      unsubscribed: false,
      properties: { language: list, template: buyer.product, source: "polar-import" },
    });

    if (created.error) {
      console.error(`  FAIL   ${buyer.email.padEnd(34)} ${created.error.name}: ${created.error.message}`);
      tally.failed++;
    } else {
      console.log(`  added  ${buyer.email.padEnd(34)} -> ${list} list  (${buyer.product || "unknown product"})`);
      tally.added++;
    }
  } catch (error) {
    console.error(`  FAIL   ${buyer.email.padEnd(34)}`, error);
    tally.failed++;
  }
}

console.log(`\n${WRITE ? "written" : "would add"}: ${tally.added}` +
  ` | already on a list: ${tally.already}` +
  ` | unsubscribed, left alone: ${tally.unsubscribed}` +
  ` | failed: ${tally.failed}`);
