import type { Metadata } from "next";
import ReportView from "../../ReportView";

// A report belongs to whoever has the link. It must never be listed or indexed.
export const metadata: Metadata = {
  title: "تقرير موقعك | وائل",
  robots: { index: false, follow: false },
};

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Read here, on the server, and passed down: the number lives in an env var so it
  // stays out of this public repo, and a client component cannot read a private one.
  const digits = (process.env.AUDIT_CTA_WHATSAPP ?? "").replace(/\D/g, "");
  return <ReportView id={id} whatsapp={digits.length >= 8 ? digits : null} />;
}
