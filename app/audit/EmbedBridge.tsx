"use client";

// When the audit is shown INSIDE another page (the Framer page at waelwebdesign.com/audit),
// the page around it cannot see how tall the audit is, so an iframe of a fixed height would
// either cut the report off or leave an empty gap. This tells the parent, with two messages:
//
//   { type: "wael-audit:height", height }  the height of the audit in px, sent now and on every change
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
    // the page around us does not flicker. The first measurement goes out at once.
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(send, 120);
    };
    const observer = new ResizeObserver(settle);
    observer.observe(root);
    send();
    return () => {
      observer.disconnect();
      clearTimeout(timer);
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
