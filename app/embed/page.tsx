import type { Metadata } from "next";
import ChatWidget from "@/app/components/ChatWidget";

export const metadata: Metadata = {
  title: "مساعد وائل",
  robots: { index: false, follow: false },
};

export default function EmbedPage() {
  // Fills the iframe exactly: no page scrollbar, no margin, no rounding. The
  // rounded corners and shadow are the iframe's job, on the Framer side.
  return (
    <main className="flex h-full flex-1 flex-col overflow-hidden">
      <ChatWidget variant="panel" />
    </main>
  );
}
