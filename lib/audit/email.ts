// The two emails an audit sends:
//   1. the report email, to the VISITOR (score, top 3, a private link)
//   2. a plain notice, to WAEL (who asked, for which site, what they scored)
//
// Built to the same rules as emails/announcement-ar.html (see emails/README.md):
// tables not divs, inline styles, 600px, dir="rtl" on BOTH <html> and <body>,
// system fonts, light colours only.
//
// EVERYTHING A VISITOR TYPED IS ESCAPED. The name and the website end up inside
// HTML. `esc()` turns < > & " into harmless text, so a name like <script> shows
// up as the letters it is and never runs.
//
// The report email carries NO unsubscribe link: it is a one-off message the
// visitor asked for, not a broadcast. Broadcasts to the audit segment must carry
// {{{RESEND_UNSUBSCRIBE_URL}}} with the segment attached (CLAUDE.md).

import { Resend } from "resend";
import { EMAIL, FINDINGS, GRADES, parts, plain } from "./copy-ar.ts";
import { dryRun } from "./lead.ts";
import type { AuditReport } from "./types.ts";

const { esc } = EMAIL;
const FROM = () => process.env.LEAD_FROM_EMAIL || "onboarding@resend.dev";
const FONT = "'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif";
const ACCENT = "#ff4a11";

function recipients(): string[] {
  return (process.env.LEAD_TO_EMAIL ?? "").split(",").map((a) => a.trim()).filter(Boolean);
}

/** Escaped HTML for text that may contain `code` spans: each one isolated left-to-right. */
function rich(text: string): string {
  return parts(text)
    .map((p) => (p.code ? `<bdi dir="ltr" style="font-family:Menlo,Consolas,monospace;font-size:0.92em;">${esc(p.text)}</bdi>` : esc(p.text)))
    .join("");
}

export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0]?.slice(0, 40) ?? "";
}

/** The three lines the email leads with: a title and, when there is one, the proof. */
function topLines(report: AuditReport): { title: string; evidence: string }[] {
  return report.top.slice(0, 3).map((id) => {
    const copy = FINDINGS[id];
    const finding = report.findings.find((f) => f.id === id);
    return { title: copy?.title ?? id, evidence: copy?.evidence && finding ? copy.evidence(finding.params) : "" };
  });
}

export function buildReportEmail(input: { name: string; domain: string; report: AuditReport; link: string }) {
  const { report, domain, link } = input;
  const score = report.score;
  const first = firstNameOf(input.name);
  const grade = report.grade ? GRADES[report.grade] : null;
  const lines = topLines(report);
  const subject = EMAIL.subject(domain, score);

  const scoreBlock =
    score === null
      ? `<p style="margin:0;font-size:16px;line-height:1.9;color:#3f3f46;">${esc(EMAIL.noScore)}</p>`
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
           <td style="font-family:${FONT};font-size:56px;line-height:1;font-weight:700;color:#18181b;padding-left:12px;">${score}</td>
           <td style="font-family:${FONT};font-size:16px;line-height:1.6;color:#71717a;">من 100<br><strong style="color:#18181b;font-size:18px;">${esc(grade?.label ?? "")}</strong></td>
         </tr></table>
         <p style="margin:12px 0 0 0;font-size:15px;line-height:1.9;color:#3f3f46;">${esc(grade?.line ?? "")}</p>`;

  const list = lines.length
    ? `<tr><td style="padding:22px 24px 0 24px;font-family:${FONT};">
         <p style="margin:0 0 8px 0;font-size:16px;font-weight:700;color:#18181b;">${esc(EMAIL.top)}</p>
         ${lines
           .map(
             (l, i) => `<p style="margin:10px 0 0 0;font-size:15px;line-height:1.8;color:#3f3f46;">
               <strong style="color:#18181b;">${i + 1}. ${rich(l.title)}</strong>
               ${l.evidence ? `<br><span style="color:#71717a;font-size:14px;">${rich(l.evidence)}</span>` : ""}</p>`
           )
           .join("")}
       </td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
</head>
<body dir="rtl" style="margin:0;padding:0;background-color:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(EMAIL.preheader(score))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:28px 24px 0 24px;font-family:${FONT};"><p style="margin:0;font-size:14px;color:#71717a;">وائل ويب ديزاين</p></td></tr>
    <tr><td style="padding:14px 24px 0 24px;font-family:${FONT};">
      <h1 style="margin:0;font-size:24px;line-height:1.5;color:#18181b;font-weight:700;">${esc(EMAIL.heading)} <bdi dir="ltr">${esc(domain)}</bdi></h1>
    </td></tr>
    <tr><td style="padding:14px 24px 0 24px;font-family:${FONT};">
      <p style="margin:0;font-size:16px;line-height:1.9;color:#3f3f46;">${esc(EMAIL.greeting(first))}<br>${esc(EMAIL.intro(domain))}</p>
    </td></tr>
    <tr><td style="padding:20px 24px 0 24px;font-family:${FONT};">${scoreBlock}</td></tr>
    ${list}
    <tr><td align="center" style="padding:28px 24px 8px 24px;font-family:${FONT};">
      <a href="${esc(link)}" style="display:inline-block;background-color:${ACCENT};color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;line-height:1.4;padding:14px 28px;border-radius:8px;">${esc(EMAIL.button)}</a>
    </td></tr>
    <tr><td style="padding:20px 24px 28px 24px;font-family:${FONT};">
      <p style="margin:0;font-size:13px;line-height:1.8;color:#71717a;">${esc(EMAIL.why)}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    EMAIL.greeting(first),
    EMAIL.intro(domain),
    "",
    score === null ? EMAIL.noScore : `الدرجة: ${score} من 100 (${grade?.label ?? ""})`,
    ...(lines.length ? ["", EMAIL.top, ...lines.map((l, i) => plain(`${i + 1}. ${l.title}${l.evidence ? ` — ${l.evidence}` : ""}`))] : []),
    "",
    `${EMAIL.button}: ${link}`,
    "",
    EMAIL.why,
  ].join("\n");

  return { subject, html, text };
}

export async function sendReportEmail(input: {
  to: string;
  name: string;
  domain: string;
  report: AuditReport;
  link: string;
  test?: boolean;
}): Promise<boolean> {
  const mail = buildReportEmail(input);
  const subject = `${input.test ? "[TEST] " : ""}${mail.subject}`;

  if (dryRun()) {
    console.log(`[audit:dry-run] would email the report to ${input.to}: ${subject}`);
    return true;
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("Report email not sent: RESEND_API_KEY is missing.");
    return false;
  }
  try {
    const { error } = await new Resend(apiKey).emails.send({
      from: FROM(),
      to: input.to,
      replyTo: recipients(),
      subject,
      html: mail.html,
      text: mail.text,
    });
    if (error) {
      console.error("Report email failed:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Resend threw while sending the report:", error);
    return false;
  }
}

/** A short plain-text note to Wael: who asked, for which site, how it went. */
export async function sendLeadNotice(input: {
  name: string;
  email: string;
  domain: string;
  report: AuditReport | null;
  failure?: string;
  link: string;
  listOutcome: string;
  test?: boolean;
}): Promise<boolean> {
  const to = recipients();
  const score = input.report?.score;
  const body = [
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Website: ${input.domain}`,
    input.report
      ? `Score: ${score ?? "no score (could not read the site)"}${score != null ? "/100" : ""} ${input.report.grade ? `(${input.report.grade})` : ""}`
      : `Audit failed: ${input.failure ?? "unknown"}`,
    ...(input.report ? ["Top problems:", ...topLines(input.report).map((l) => `  - ${plain(l.title)}`)] : []),
    `Report: ${input.link}`,
    `Mailing list: ${input.listOutcome}`,
    "Consent: ticked the consent box on the form",
  ].join("\n");
  const subject = `${input.test ? "[TEST] " : ""}New audit lead: ${input.name.slice(0, 60)} — ${input.domain}${score != null ? ` — ${score}/100` : ""}`;

  if (dryRun()) {
    console.log(`[audit:dry-run] would email Wael: ${subject}\n${body}`);
    return true;
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || to.length === 0) {
    console.error("Lead notice not sent: RESEND_API_KEY or LEAD_TO_EMAIL is missing.");
    return false;
  }
  try {
    const { error } = await new Resend(apiKey).emails.send({
      from: FROM(),
      to,
      // Reply goes to the visitor, so answering the notice IS answering the lead. The address
      // passed the shape check in the route and contains no whitespace, so it cannot add headers.
      replyTo: input.email,
      subject,
      text: body,
    });
    if (error) {
      console.error("Lead notice failed:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Resend threw while sending the lead notice:", error);
    return false;
  }
}
