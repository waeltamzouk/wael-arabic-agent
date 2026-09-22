"use client";

import { useState } from "react";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/countries";

// The contact form that appears inside the conversation when Claude calls
// `request_contact`. It is a CARD IN THE MESSAGE LIST, not a popup: it shows up
// where the next reply would have been, at the moment the visitor is already
// expecting to be asked, and it can be scrolled past like anything else.
//
// The country dropdown is the whole reason this exists. A number typed into a
// chat sentence arrives with no country attached, and "0551234567" is a real
// mobile in Saudi AND the UAE — so the wa.me link in the lead email either had
// to be guessed or left out. Picked from a list, the country is a fact.

type Props = {
  language: "ar" | "en";
  // What Claude gathered from the conversation. Passed straight back to
  // /api/lead, which re-checks every field of it.
  notes: Record<string, unknown>;
  endpoint: string;
  onSent: () => void;
  onDismiss: () => void;
};

const COPY = {
  ar: {
    title: "بياناتك",
    subtitle: "عشان وائل يتواصل معك",
    name: "الاسم",
    namePlaceholder: "اسمك",
    country: "الدولة",
    phone: "رقم الجوال",
    email: "الإيميل",
    optional: "اختياري",
    send: "إرسال",
    sending: "جاري الإرسال…",
    dismiss: "أفضل الكتابة في المحادثة",
    nameError: "اكتب اسمك من فضلك.",
    phoneError: "اكتب رقم جوالك.",
    failed: "تعذر إرسال بياناتك. حاول مرة أخرى.",
  },
  en: {
    title: "Your details",
    subtitle: "So Wael can get in touch",
    name: "Name",
    namePlaceholder: "Your name",
    country: "Country",
    phone: "Phone number",
    email: "Email",
    optional: "optional",
    send: "Send",
    sending: "Sending…",
    dismiss: "I'd rather type it in the chat",
    nameError: "Please enter your name.",
    phoneError: "Please enter your phone number.",
    failed: "Your details could not be sent. Please try again.",
  },
} as const;

// Matches the server's floor in app/api/lead/route.ts. Checked here too so an
// obvious mistake is caught without a round trip.
const MIN_PHONE_DIGITS = 6;

// GOTCHA: no width in here. This string is shared with the country select,
// which must NOT be full width, and putting `w-full` here and `w-auto` on the
// select does not work — both classes end up on the element and the stylesheet
// order decides, not the order they are written in. `w-full` won, the select
// filled the row, and the phone input collapsed to nothing. Width is set per
// field instead.
const FIELD_CLASS =
  "rounded-xl bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none ring-1 ring-zinc-200 focus:ring-2 focus:ring-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 dark:ring-zinc-800 dark:focus:ring-zinc-100";

const LABEL_CLASS = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

export default function ContactForm({
  language,
  notes,
  endpoint,
  onSent,
  onDismiss,
}: Props) {
  const t = COPY[language];

  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY.code);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;

    if (!name.trim()) return setError(t.nameError);
    if (phone.replace(/\D/g, "").length < MIN_PHONE_DIGITS) {
      return setError(t.phoneError);
    }

    setError(null);
    setSending(true);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          countryCode,
          phone,
          email: email.trim(),
          language,
          notes,
        }),
      });

      const data: { ok?: boolean; notice?: string } = await res.json();

      // Same rule as the chat widget: `notice` is written for the visitor and
      // is safe to show, `error` is for the logs and may be raw English.
      if (!res.ok || !data.ok) throw new Error(data.notice ?? t.failed);

      onSent();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t.failed);
      // Deliberately NOT cleared: the visitor keeps everything they typed and
      // can just press send again.
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      // The root layout is dir="rtl" for the Arabic site, so an ENGLISH
      // visitor would otherwise get right-aligned labels and the country code
      // on the wrong side of the phone field. The bubbles get away with
      // dir="auto" because they are one run of text; a form is a layout.
      dir={language === "en" ? "ltr" : "rtl"}
      // Full width, unlike a bubble: at 380px the panel has no room to spare
      // and the phone row needs every pixel of it.
      className="w-full self-stretch rounded-2xl bg-zinc-100 p-4 dark:bg-zinc-900"
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {t.title}
        </h3>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {t.subtitle}
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label htmlFor="lead-name" className={LABEL_CLASS}>
            {t.name}
          </label>
          <input
            id="lead-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            dir="auto"
            placeholder={t.namePlaceholder}
            className={`${FIELD_CLASS} w-full`}
          />
        </div>

        <div>
          <label htmlFor="lead-phone" className={LABEL_CLASS}>
            {t.phone}
          </label>
          <div className="flex gap-2">
            <select
              aria-label={t.country}
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className={`${FIELD_CLASS} shrink-0`}
            >
              {COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.flag} +{country.code}
                </option>
              ))}
            </select>
            <input
              id="lead-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              // `tel` brings up the phone keypad on a mobile, which is most of
              // the traffic. `dir="ltr"` because a number typed into an RTL
              // field gets its digits visually reordered by the bidi algorithm
              // and the visitor cannot tell what they typed.
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              dir="ltr"
              placeholder="5X XXX XXXX"
              className={`${FIELD_CLASS} w-full`}
            />
          </div>
        </div>

        <div>
          <label htmlFor="lead-email" className={LABEL_CLASS}>
            {t.email}{" "}
            <span className="font-normal text-zinc-400 dark:text-zinc-500">
              ({t.optional})
            </span>
          </label>
          <input
            id="lead-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            placeholder="name@example.com"
            className={`${FIELD_CLASS} w-full`}
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={sending}
          className="h-10 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {sending ? t.sending : t.send}
        </button>

        {/* A way out that is not "close the chat". Without it the only escape
            from a form you do not want to fill is leaving the site. */}
        <button
          type="button"
          onClick={onDismiss}
          disabled={sending}
          className="text-xs text-zinc-500 underline underline-offset-2 transition-colors hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {t.dismiss}
        </button>
      </div>
    </form>
  );
}
