import { Resend } from "resend";

export type Lead = {
  name: string;
  phone: string;
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

export async function sendLead(lead: Lead) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_TO_EMAIL;

  if (!apiKey || !to) {
    console.error("Lead not sent: RESEND_API_KEY or LEAD_TO_EMAIL is missing.");
    return false;
  }

  const body = [
    line("Type", lead.type),
    line("Name", lead.name),
    line("Phone", lead.phone),
    line("Business", lead.business),
    line("Project", lead.project),
    line("Budget", lead.budget),
    line("Timeline", lead.timeline),
    line("Needs", lead.needs),
    line("Quality", lead.quality),
  ].join("\n");

  try {
    // Built here, not at module top level: the constructor throws on a missing key.
    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from: FROM,
      to,
      subject: `New ${lead.type ?? "project"} lead: ${lead.name} — ${
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
