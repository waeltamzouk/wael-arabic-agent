import type { Metadata } from "next";
import ChatWidget from "@/app/components/ChatWidget";

export const metadata: Metadata = {
  title: "مساعد وائل",
  robots: { index: false, follow: false },
};

export default function EmbedPage() {
  // `fixed inset-0` and not a normal flex child. GOTCHA: `body` carries
  // `min-h-full` from the shared root layout, so it GROWS with its content —
  // correct for the marketing homepage, fatal here. A tall conversation made
  // body 1556px inside a 600px iframe, so the whole document scrolled, the
  // message list never overflowed (scrollHeight === clientHeight, so
  // scroll-to-bottom was a no-op and every restored chat opened at the very
  // top), and the composer was pushed off the bottom entirely.
  // `fixed` takes this out of flow and pins it to the iframe's viewport, so
  // the message list is the only thing that scrolls.
  return (
    <main className="fixed inset-0 flex flex-col overflow-hidden">
      <ChatWidget variant="panel" />
    </main>
  );
}
