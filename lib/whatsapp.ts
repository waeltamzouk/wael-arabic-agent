// W6-T3: the tappable WhatsApp link in the lead email.
//
// wa.me takes DIGITS ONLY — country code included, no +, no spaces, no
// dashes. The dangerous part is that a wrong number does not fail loudly:
// wa.me opens a chat with whoever owns those digits, or with nobody, and
// either way Wael thinks he has messaged the lead. A dead link is worse
// than no link, so the rule throughout this file is: emit a link only when
// the number states its own country, and otherwise say why it didn't.

// Visitors on an Arabic site type Arabic-Indic digits often enough to matter.
const ARABIC_INDIC = /[٠-٩۰-۹]/g;

// A phone-shaped run: digits with the separators people actually type between
// them. Letters are NOT in the class on purpose — that is what stops
// "055 123 4567 (after 5pm)" from swallowing the 5 of "5pm".
const PHONE_RUN = /\+?\d[\d\s\-().  ]*\d/g;

// Below 7 digits it is a house number or a year, not a phone number.
const MIN_RUN_DIGITS = 7;
// E.164: at most 15 digits, and nothing real is shorter than 8 with a
// country code on the front.
const MIN_E164 = 8;
const MAX_E164 = 15;

export type WhatsAppLink =
  | { ok: true; url: string; digits: string }
  // `reason` is printed in the lead email, so it is written for Wael.
  | { ok: false; reason: string };

function toAsciiDigits(input: string): string {
  return input.replace(ARABIC_INDIC, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

// Accepts "966", "+966", "00966" — whatever Wael pastes into the env var.
// Returns "" for anything that is not a plausible country calling code, so a
// typo silently disables the link instead of building wrong ones.
export function normaliseCountryCode(raw?: string): string {
  const digits = (raw ?? "").replace(/\D/g, "").replace(/^00/, "");
  return digits.length >= 1 && digits.length <= 4 ? digits : "";
}

/**
 * Turn whatever the visitor typed into a wa.me URL, or explain why not.
 *
 * `countryCode` is the country Wael's leads come from. It is only consulted
 * for LOCAL numbers ("0551234567"), which carry no country of their own —
 * and "0551234567" is a valid mobile in Saudi Arabia AND the UAE, so there
 * is nothing to infer it from. Unset means local numbers get no link.
 */
export function whatsappLink(
  phone: string,
  countryCode = process.env.LEAD_DEFAULT_COUNTRY_CODE,
): WhatsAppLink {
  const cc = normaliseCountryCode(countryCode);
  const runs = toAsciiDigits(phone ?? "").match(PHONE_RUN) ?? [];
  const candidates = runs.filter(
    (run) => run.replace(/\D/g, "").length >= MIN_RUN_DIGITS,
  );

  if (candidates.length === 0) {
    return { ok: false, reason: "no phone number found in the field" };
  }
  if (candidates.length > 1) {
    return { ok: false, reason: "more than one number given — pick one by hand" };
  }

  const run = candidates[0];
  let digits = run.replace(/\D/g, "");

  // Two numbers separated by nothing but a space read as one long run. Caught
  // here, before a country code is added, so the count names what was typed.
  if (digits.length > MAX_E164) {
    return {
      ok: false,
      reason: `${digits.length} digits — looks like more than one number`,
    };
  }
  // "+971…" and "00971…" both say their own country. A bare leading 0 is the
  // national trunk prefix and says nothing.
  const international = run.startsWith("+") || digits.startsWith("00");

  if (international) {
    digits = digits.replace(/^00/, "");
    // "+966 0551234567" — a country code AND the trunk zero. Only corrected
    // when the zero follows the configured country code, so this can never
    // mangle a number from somewhere else.
    if (cc && digits.startsWith(`${cc}0`)) {
      digits = cc + digits.slice(cc.length).replace(/^0+/, "");
    }
  } else if (!cc) {
    return {
      ok: false,
      reason:
        "local number, country unknown — set LEAD_DEFAULT_COUNTRY_CODE to link these",
    };
  } else if (digits.startsWith("0")) {
    digits = cc + digits.replace(/^0+/, "");
  } else if (!digits.startsWith(cc)) {
    // No +, no trunk zero: a national number written bare. The configured
    // country code is the only thing we have, and configuring it is Wael
    // saying his leads come from there.
    digits = cc + digits;
  }

  if (digits.length < MIN_E164 || digits.length > MAX_E164) {
    return {
      ok: false,
      reason: `${digits.length} digits is not a usable WhatsApp number`,
    };
  }

  // digits is /^\d+$/ by construction, so nothing here can escape the URL.
  return { ok: true, url: `https://wa.me/${digits}`, digits };
}
