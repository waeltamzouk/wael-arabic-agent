import type { NextConfig } from "next";

// Who is allowed to put /embed inside an iframe. Without this, ANY site can
// frame the widget and run up the API bill under their own brand.
//
// `frame-ancestors` is the modern replacement for X-Frame-Options, and unlike
// it, it takes a list. X-Frame-Options is deliberately NOT set — it only
// understands DENY and SAMEORIGIN, so it would block the Framer site too.
const FRAME_ANCESTORS = [
  "'self'",
  "https://waelwebdesign.com",
  "https://*.waelwebdesign.com",
  // The English templates site (its bubble loads /embed?site=templates).
  "https://waeltamzouk.framer.ai",
  // Framer's own preview domains, so the bubble can be tested before publishing.
  "https://*.framer.website",
  "https://*.framer.app",
  // Anything else goes in the FRAME_ANCESTORS env var in Vercel, space separated.
  ...(process.env.FRAME_ANCESTORS ?? "").split(/[\s,]+/).filter(Boolean),
  // Dev only: lets you drop the Framer snippet into a local page and try the
  // whole bubble before publishing. Never added in production.
  ...(process.env.NODE_ENV === "production"
    ? []
    : ["http://localhost:*", "http://127.0.0.1:*"]),
];

const FRAME_RULE = [
  {
    key: "Content-Security-Policy",
    value: `frame-ancestors ${FRAME_ANCESTORS.join(" ")};`,
  },
];

// The audit is shown inside the Framer page at waelwebdesign.com/audit (see
// app/audit/EmbedBridge.tsx). On top of the list above it also allows Framer's own editor,
// framer.com (the design canvas is drawn inside that page), so the tool can be looked at while
// building the page. Only the audit gets this, not the chat window. `*.` needs a subdomain,
// so the bare domain is listed too.
const AUDIT_FRAME_RULE = [
  {
    key: "Content-Security-Policy",
    value: `frame-ancestors ${[...FRAME_ANCESTORS, "https://framer.com", "https://*.framer.com"].join(" ")};`,
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/embed", headers: FRAME_RULE },
      // `:path*` also matches /audit itself. Top-level visits, such as the link in the report
      // email, are not affected: this only limits who may FRAME the page.
      { source: "/audit/:path*", headers: AUDIT_FRAME_RULE },
    ];
  },
};

export default nextConfig;
