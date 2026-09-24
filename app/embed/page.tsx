import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ChatWidget from "@/app/components/ChatWidget";
import { siteFromParam } from "@/lib/site";

export async function generateMetadata({
  searchParams,
}: PageProps<"/embed">): Promise<Metadata> {
  const { site } = await searchParams;
  return {
    title:
      siteFromParam(typeof site === "string" ? site : null) === "templates"
        ? "Wael's template assistant"
        : "مساعد وائل",
    robots: { index: false, follow: false },
  };
}

// `?site=templates` is the English templates site's panel. No param is the
// Arabic one — that is the URL the live waelwebdesign.com snippet already
// loads, so it must keep meaning Arabic. An unknown value 404s rather than
// quietly showing the Arabic agent, so a typo in a Framer paste is obvious.
export default async function EmbedPage({ searchParams }: PageProps<"/embed">) {
  const { site: param } = await searchParams;
  const site = siteFromParam(typeof param === "string" ? param : null);
  if (!site) notFound();

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
