"use client";

// When the audit is shown INSIDE another page (the Framer page at waelwebdesign.com/audit),
// the page around it cannot see how tall the audit is, so an iframe of a fixed height would
// either cut the report off or leave an empty gap. This tells the parent, with two messages:
//
//   { type: "wael-audit:height", height }  the height of the audit in px: on every change, repeated
//                                          while the parent wakes up, and on request ("wael-audit:hello")
//   { type: "wael-audit:page",   path   }  the visitor moved to another screen (form -> report), so the
//                                          parent can scroll the top of the audit back into view
//
// Only numbers and a path are sent, so "*" as the target is harmless: who may FRAME this page
// is decided by `frame-ancestors` in next.config.ts. Does nothing when the page is not framed.
// The header and footer are hidden by the small style the layout injects in that same case.

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export default function EmbedBridge() {
  const pathname = usePathname();
  const previous = useRef(pathname);

  useEffect(() => {
    if (window.self === window.top) return;
    const root = document.querySelector(".audit-root");
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = () =>
      window.parent.postMessage({ type: "wael-audit:height", height: Math.ceil(root.getBoundingClientRect().height) }, "*");
    // While the visitor moves from one screen to another the page briefly holds both screens, and
    // the height jumps around. Only a height that has stopped changing for a moment is reported, so
    // the page around us does not flicker.
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(send, 120);
    };
    const observer = new ResizeObserver(settle);
    observer.observe(root);

    // ONE message is not enough, and this is a real bug found on the live page: the Framer page
    // wakes up (hydrates) AFTER this frame has loaded, so a height sent once, at load, arrives
    // before anyone is listening and is lost. From then on the size usually does not change (fonts
    // are cached), so nothing is ever sent again and the frame stays at its minimum height with a
    // scrollbar inside. So the height is repeated while the page around us wakes up, and sent at
    // once whenever the parent says hello. Repeats of the same number are harmless: the parent
    // ignores a height it already has.
    const repeats = [0, 400, 1200, 2500, 5000, 9000, 15000, 25000, 40000].map((ms) => setTimeout(send, ms));
    const onHello = (event: MessageEvent) => {
      if (event.source === window.parent && event.data && event.data.type === "wael-audit:hello") send();
    };
    window.addEventListener("message", onHello);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
      repeats.forEach(clearTimeout);
      window.removeEventListener("message", onHello);
    };
  }, []);

  useEffect(() => {
    // Compared with where we were, not "is this the first run": the development server runs every
    // effect twice, and loading the page must never make the parent scroll.
    if (previous.current === pathname) return;
    previous.current = pathname;
    if (window.self !== window.top) window.parent.postMessage({ type: "wael-audit:page", path: pathname }, "*");
  }, [pathname]);

  return null;
}
