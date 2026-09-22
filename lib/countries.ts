// The country dropdown next to the phone field, shared by the form and by
// `/api/lead` — the server must never accept a calling code the form could
// not have offered, so this list is the allowlist too.
//
// Saudi first because that is where most of Wael's clients are. The rest are
// the neighbours a Gulf visitor might plausibly be dialling from, plus Turkey,
// where Wael is.

export type Country = {
  // The calling code, digits only, exactly as wa.me wants it.
  code: string;
  flag: string;
  ar: string;
  en: string;
};

export const COUNTRIES: Country[] = [
  { code: "966", flag: "🇸🇦", ar: "السعودية", en: "Saudi Arabia" },
  { code: "971", flag: "🇦🇪", ar: "الإمارات", en: "UAE" },
  { code: "965", flag: "🇰🇼", ar: "الكويت", en: "Kuwait" },
  { code: "974", flag: "🇶🇦", ar: "قطر", en: "Qatar" },
  { code: "973", flag: "🇧🇭", ar: "البحرين", en: "Bahrain" },
  { code: "968", flag: "🇴🇲", ar: "عُمان", en: "Oman" },
  { code: "20", flag: "🇪🇬", ar: "مصر", en: "Egypt" },
  { code: "962", flag: "🇯🇴", ar: "الأردن", en: "Jordan" },
  { code: "90", flag: "🇹🇷", ar: "تركيا", en: "Türkiye" },
];

export const DEFAULT_COUNTRY = COUNTRIES[0];

export function isKnownCountryCode(code: unknown): code is string {
  return (
    typeof code === "string" && COUNTRIES.some((country) => country.code === code)
  );
}
