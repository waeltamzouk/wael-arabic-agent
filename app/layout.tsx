import type { Metadata } from "next";
import { Fira_Mono, Geist, Geist_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

// The English templates panel's font, matched to waeltamzouk.framer.ai, whose
// body text is Fira Mono. Only `[data-site="templates"]` uses it (globals.css).
// NOT preloaded: every Arabic page shares this layout, and a preload would
// make each of them download a font they never show.
const firaMono = Fira_Mono({
  variable: "--font-fira-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  preload: false,
});

export const metadata: Metadata = {
  title: "وائل — مصمم مواقع فريمر",
  description:
    "تصميم مواقع احترافية على فريمر — مواقع شركات، صفحات هبوط، ومتاجر إلكترونية.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${geistSans.variable} ${geistMono.variable} ${ibmPlexArabic.variable} ${firaMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
