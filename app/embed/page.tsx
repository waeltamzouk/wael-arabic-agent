import type { Metadata } from "next";
import ChatWidget from "@/app/components/ChatWidget";

export const metadata: Metadata = {
  title: "مساعد وائل",
  robots: { index: false, follow: false },
};

export default function EmbedPage() {
  return (
    <main className="flex flex-1 flex-col">
      <ChatWidget />
    </main>
  );
}
