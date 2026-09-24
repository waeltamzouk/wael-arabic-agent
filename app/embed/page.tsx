import type { Metadata } from "next";
import ChatWidget from "@/app/components/ChatWidget";
import { siteFromParam } from "@/lib/site";

export async function generateMetadata({
  searchParams,
}: PageProps<"/embed">): Promise<Metadata> {
  const { site } = await searchParams;
  const english =
    siteFromParam(typeof site === "string" ? site : null) === "templates";
  return {
    title: english ? "Wael's template assistant" : "مساعد وائل",
    // Overrides the root layout's Arabic description, which would otherwise
    // ride along into the English panel.
    ...(english
      ? { description: "Ask about Wael Tamzouk's Framer templates." }
      : {}),
    robots: { index: false, follow: false },
  };
}

// `?site=templates` is the English templates site's panel. No param is the
// Arabic one — that is the URL the live waelwebdesign.com snippet already
// loads, so it must keep meaning Arabic. An unknown value ALSO gets the Arabic
// panel (see siteFromParam) — never a 404, never a crash. The panel then sends
// no `?site` to /api/chat, so the prompt always matches the panel on screen.
export default async function EmbedPage({ searchParams }: PageProps<"/embed">) {
  const { site: param } = await searchParams;
  const site = siteFromParam(typeof param === "string" ? param : null);

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
      <ChatWidget variant="panel" site={site} />
    </main>
  );
}
