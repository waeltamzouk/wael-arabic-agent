import type { ReactNode } from "react";
import EmbedBridge from "./EmbedBridge";

// The frame around every /audit page: the landing page, the progress screen and the
// report. Dressed like waelwebdesign.com (see the `.audit-root` block in globals.css).
// The pages inside only have to supply their own content.

const BOLD_FONT = "https://framerusercontent.com/assets/0SzM07uZ5RKGQlPCh6YyxMpGsaM.woff2";

// "Inside Framer" mode. When this page is shown in an iframe (the Framer page at
// waelwebdesign.com/audit) it drops its own header and footer, stops stretching to the height of
// the window, and EmbedBridge tells the parent how tall it is. The decision is made by this tiny
// script, which runs before anything below it is painted, so there is no flash of the header.
// It adds a <style> to <head> instead of an attribute to <html>: React then has nothing to
// disagree with while hydrating. A page opened on its own never gets the style.
const EMBED_CSS =
  ".audit-chrome{display:none!important}" +
  "html,body{height:auto!important;min-height:0!important;background:#000!important}" +
  ".audit-root{flex:none!important}" +
  ".audit-root main{padding-top:1.5rem!important}";
const EMBED_SCRIPT =
  "try{if(window.self!==window.top){var s=document.createElement('style');" +
  `s.textContent=${JSON.stringify(EMBED_CSS)};document.head.appendChild(s)}}catch(e){}`;

function ArrowUpRight() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 11 11 5M6 5h5v5" />
    </svg>
  );
}

export default function AuditLayout({ children }: { children: ReactNode }) {
  return (
    <div className="audit-root flex flex-1 flex-col bg-ink">
      <script dangerouslySetInnerHTML={{ __html: EMBED_SCRIPT }} />
      <EmbedBridge />
      {/* Starts the headline font downloading before the page asks for it. */}
      <link rel="preload" href={BOLD_FONT} as="font" type="font/woff2" crossOrigin="anonymous" />

      <header className="audit-chrome px-4 pt-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between rounded-full bg-white/[0.07] px-5 py-3 ring-1 ring-hair backdrop-blur">
          <a href="https://waelwebdesign.com" className="flex items-center gap-2.5 text-[15px] font-bold text-white">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-accent" />
            وائل ويب ديزاين
          </a>
          <a
            href="https://waelwebdesign.com"
            className="flex items-center gap-1.5 text-sm text-mute transition-colors hover:text-white focus-visible:text-white"
          >
            <span dir="ltr">waelwebdesign.com</span>
            <ArrowUpRight />
          </a>
        </div>
      </header>

      <div className="flex flex-1 flex-col">{children}</div>

      <footer className="audit-chrome px-4 pb-10 pt-16 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 border-t border-hair pt-6 text-sm text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>وائل — Framer Official Expert. أبني مواقع عربية سريعة وواضحة.</p>
          <a href="https://waelwebdesign.com" className="text-mute underline underline-offset-4 transition-colors hover:text-white">
            <bdi dir="ltr">waelwebdesign.com</bdi>
          </a>
        </div>
      </footer>
    </div>
  );
}
