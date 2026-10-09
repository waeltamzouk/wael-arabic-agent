// The dot-matrix display font for the BIG numbers on the client dashboard (the
// "wael-style" skill: dot-matrix numerals, one hero number per card, never for
// small text or anything that must be read fast). Loaded here, once, and handed
// to the page as a CSS variable; `Dashboard.tsx` uses it through `DOT`.
//
// One weight only (800): the dots are thin, and a lighter weight turns to dust
// at 36px. Latin digits only, which is what the dashboard prints in Arabic too.

import { Doto } from "next/font/google";

export const dotFont = Doto({
  subsets: ["latin"],
  weight: ["800"],
  variable: "--font-dot",
  display: "swap",
});
