import { Resend } from "resend";
import { whatsappLink } from "./whatsapp";
import { DEFAULT_SITE, type Site } from "./site";

export type Lead = {
  name: string;
  phone: string;
  // Optional on purpose: the form marks it optional, because a third required
  // field costs more leads than the addresses are worth.
  email?: string;
  // Where the lead came from. Set only by the WhatsApp channel, so website
  // leads read exactly as they always did; a WhatsApp one says so in the
  // subject and on its own line.
  channel?: "WhatsApp";
  // "project" = wants a new site built. "template" = wants a template customized.
  type?: "project" | "template";
  business?: string;
  project?: string;
  budget?: string;
  timeline?: string;
  needs?: string;
  quality?: string;
};

const FROM = process.env.LEAD_FROM_EMAIL || "onboarding@resend.dev";

function line(label: string, value?: string) {
  return `${label}: ${value?.trim() || "—"}`;
}

// An ADDITION to the plain phone number above it, never a replacement: the
// number itself is always readable even when no link could be built. Bare
// https:// URLs are auto-linked by Gmail and Apple Mail, so this is one tap
// on a phone without the email needing an HTML part.
function whatsappLine(phone: string) {
  const link = whatsappLink(phone);
  return link.ok
    ? line("WhatsApp", link.url)
    : line("WhatsApp", `no link — ${link.reason}`);
}

/**
 * Who gets this site's leads. A client's leads must reach THEIR inbox, not
 * Wael's, so every site other than the Arabic one reads its own variable:
 * `templates` -> LEAD_TO_EMAIL_TEMPLATES, `al-noor` -> LEAD_TO_EMAIL_AL_NOOR.
 * An env var, never a constant in code: this repo is public and a client's
 * address must not be in it. Comma-separated for a client with two inboxes.
 *
 * Missing falls back to LEAD_TO_EMAIL, and `fallback` is true. A lead in the
 * wrong inbox can be forwarded; a lead that was never sent is gone.
 */
function leadRecipients(site: Site): { to: string[]; fallback: boolean } {
  const split = (value?: string) =>
    (value ?? "").split(",").map((a) => a.trim()).filter(Boolean);

  if (site !== DEFAULT_SITE) {
    const own = split(
      process.env[`LEAD_TO_EMAIL_${site.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`]
    );
    if (own.length) return { to: own, fallback: false };
  }
  return { to: split(process.env.LEAD_TO_EMAIL), fallback: site !== DEFAULT_SITE };
}

export async function sendLead(lead: Lead, site: Site = DEFAULT_SITE) {
  const apiKey = process.env.RESEND_API_KEY;
  const { to, fallback } = leadRecipients(site);

  if (!apiKey || !to.length) {
    console.error("Lead not sent: RESEND_API_KEY or LEAD_TO_EMAIL is missing.");
    return false;
  }

  if (fallback) {
    console.warn(`[lead] no LEAD_TO_EMAIL for site "${site}", sent to LEAD_TO_EMAIL instead.`);
  }

  const body = [
    ...(lead.channel ? [line("Channel", lead.channel)] : []),
    line("Type", lead.type),
    line("Name", lead.name),
    line("Phone", lead.phone),
    whatsappLine(lead.phone),
    // Omitted entirely rather than shown as a dash: most leads will not have
    // one, and nine "Email: —" lines a week is just noise in the inbox.
    ...(lead.email?.trim() ? [line("Email", lead.email)] : []),
    // The agent no longer asks about the business, the budget or the content
    // (Wael would rather ask on the call), so these are usually empty. Left out
    // rather than printed as dashes, like the email.
    ...(lead.business?.trim() ? [line("Business", lead.business)] : []),
    line("Project", lead.project),
    ...(lead.budget?.trim() ? [line("Budget", lead.budget)] : []),
    line("Timeline", lead.timeline),
    ...(lead.needs?.trim() ? [line("Needs", lead.needs)] : []),
    line("Quality", lead.quality),
  ].join("\n");

  try {
    // Built here, not at module top level: the constructor throws on a missing key.
    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from: FROM,
      to,
      // `from` is a SEND-ONLY address. waelwebdesign.com has no MX records, so
      // nothing can receive mail there and a reply to it simply disappears —
      // no bounce, no warning. Reply-To points at the inbox that already gets
      // the lead, so hitting reply out of habit lands somewhere real.
      //
      // Defaulted rather than configured: the address that should receive a
      // reply is the one already receiving the lead. That also keeps a real
      // email address out of this file — the repo is public.
      replyTo: to,
      // Tagged only when a site's lead landed in the default inbox, so Wael
      // sees at a glance that it belongs to someone else and must be forwarded.
      subject: `${fallback ? `[${site}] ` : ""}New ${lead.channel ? `${lead.channel} ` : ""}${lead.type ?? "project"} lead: ${lead.name} — ${
        lead.project?.trim() || "website"
      }`,
      text: body,
    });

    if (error) {
      console.error("Resend error:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Resend threw:", error);
    return false;
  }
}
