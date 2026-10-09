// Headless Chrome over the DevTools protocol: load a page at a width, wait for the report,
// take a full-page screenshot, and measure what the eye cannot (overflow, smallest text, cards).
// Usage: node shoot.mjs <outdir> <name>=<url>@<width>[x<height>] ...
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const [outDir, ...jobs] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-shoot-"));

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(p) {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}${p}`)).json(); } catch { await sleep(200); }
  }
  throw new Error("chrome did not start");
}

const MEASURE = `(() => {
  const vw = innerWidth, doc = document.documentElement;
  const out = { vw, scrollWidth: doc.scrollWidth, overflow: doc.scrollWidth - vw, pageHeight: doc.scrollHeight };
  const bad = [];
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || e.closest('.sr-only')) continue;
    if (r.right > vw + 1 || r.left < -1) {
      let p = e.parentElement, scroller = false;
      while (p && p !== document.body) { if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX)) { scroller = true; break; } p = p.parentElement; }
      if (!scroller) bad.push(e.tagName + '.' + String(e.className || '').slice(0, 40) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    }
  }
  out.escaping = bad.slice(0, 6);
  let min = 99, minEl = '';
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const t = w.currentNode; if (!t.textContent.trim()) continue;
    const el = t.parentElement; if (el.closest('.sr-only, script, style')) continue;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (r.width === 0) continue;
    const fs = parseFloat(cs.fontSize); if (fs < min) { min = fs; minEl = el.tagName + ':' + t.textContent.trim().slice(0, 28); }
  }
  out.minFont = min; out.minFontEl = minEl;
  out.cards = [...document.querySelectorAll('main > div > section, main > div > div > section, main > div > div > div > section, main > div > div > aside, main > div > div > details, main > div > div > div > details, main article')]
    .map(e => { const r = e.getBoundingClientRect(); return Math.round(r.left) + '..' + Math.round(r.right) + ' w' + Math.round(r.width) + ' h' + Math.round(r.height) + ' ' + ((e.querySelector('h1,h2,h3,summary,p') || {}).textContent || '').trim().slice(0, 22); });
  out.shortTargets = [...document.querySelectorAll('main a, main button, main summary')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; })
    .map(e => e.tagName + ':' + e.textContent.trim().slice(0, 22) + ' h' + Math.round(e.getBoundingClientRect().height)).slice(0, 6);
  out.ticksLit = document.querySelectorAll('.audit-tick, .audit-tickbg').length;
  return out;
})()`;

try {
  await json("/json/version");
  const targets = await json("/json/list");
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const loaded = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method === "Page.loadEventFired") loaded.splice(0).forEach((f) => f());
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, (d) => (d.error ? rej(new Error(method + ": " + d.error.message)) : res(d.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  await send("Page.enable"); await send("Runtime.enable");

  for (const job of jobs) {
    const [name, rest] = job.split("=");
    const [url, size] = rest.split("@");
    const [width, height = "900"] = size.split("x").map(Number).map(String);
    await send("Emulation.setDeviceMetricsOverride", { width: +width, height: +height, deviceScaleFactor: 1, mobile: +width < 600 });
    const done = new Promise((r) => loaded.push(r));
    await send("Page.navigate", { url });
    await Promise.race([done, sleep(15000)]);
    for (let i = 0; i < 40; i++) {
      const ok = await evalJs(`document.body.innerText.length > 200 && !document.body.innerText.includes('نفحص موقعك الآن')`);
      if (ok) break; await sleep(500);
    }
    await evalJs(`document.fonts.ready.then(() => true)`);
    await sleep(2200); // the page rises in and the ticks light up
    const m = await send("Page.getLayoutMetrics");
    const { width: cw, height: ch } = m.cssContentSize ?? m.contentSize;
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: cw, height: ch, scale: 1 } });
    const file = path.join(outDir, `${name}-${width}.png`);
    fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
    const measured = await evalJs(MEASURE);
    console.log(`\n== ${name} @${width}  -> ${file}`);
    console.log(JSON.stringify(measured, null, 1));
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  fs.rmSync(profile, { recursive: true, force: true });
}
