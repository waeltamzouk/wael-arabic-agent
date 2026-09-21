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

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/embed",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${FRAME_ANCESTORS.join(" ")};`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
