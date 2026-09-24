// The English templates site's 30% code, given ONLY in exchange for an email.
// SERVER ONLY, same as lib/prompts.
//
// Wael's rule (Sep 24): the visitor types their email in the chat, the email
// goes to the English Resend Audience, and only then do they get the code.
//
// WHY THE CODE IS NOT IN THE PROMPT: anything in the prompt is something the
// model can say, so a code written there is a code it can hand out without the
// email — one clever question away. Here the model never sees the code until
// this tool has run, so it has nothing to leak.
//
// WHY IT IS AN ENV VAR, NOT A CONSTANT: this repo is PUBLIC. A code committed
// here is a code anyone on GitHub can read, gate or no gate. That is exactly
// what happened to the first code in commit 2569440. `DISCOUNT_CODE_EN` lives in
// `.env.local` and in Vercel, like the API keys.

import type Anthropic from "@anthropic-ai/sdk";
import { addBuyer, type Outcome } from "@/lib/mailing-list";
import { audienceId } from "@/lib/polar-webhook";

export const DISCOUNT_TOOL: Anthropic.Tool = {
  name: "unlock_discount",
  description:
    "Add the visitor's email to Wael's template list and get the 30% discount code for them. Call this ONLY when the visitor has typed their own email address in the chat. Never call it with an address you guessed or completed yourself. You do not know the code until this tool returns it.",
  input_schema: {
    type: "object",
    properties: {
      email: {
        type: "string",
        description: "The email address exactly as the visitor typed it.",
      },
      template: {
        type: "string",
        description:
          "The template they are most interested in, if the conversation made it clear (Pillarum, Narric, Pulsai, Navarro, Boldcore, Nokta, or All Access).",
      },
    },
    required: ["email"],
  },
};

// Deliberately loose: one @, something on both sides, a dot in the domain.
// Resend is the real judge; this only stops "no thanks" and "me@gmail" from
// being sent off as addresses.
function isEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
  );
}

export type Unlock =
  | { ok: false; metric: "discount_bad_email" | "discount_no_code"; result: string }
  | {
      ok: true;
      metric: "discount_unlocked";
      code: string;
      list: Outcome;
      /** Resend did not take the address (down, or the audience id missing). */
      listFailed: boolean;
      result: string;
    };

// The deal as the model is told to phrase it ("30% off"). Used only to COUNT
// offers for /stats, never to decide anything the visitor sees.
const OFFER = /30\s?(%|percent)/i;

/**
 * True for the FIRST reply in a conversation that mentions the 30% deal — the
 * English site's twin of `form_shown`. The history comes with every request,
 * so "first" needs no storage: no earlier assistant message may mention it.
 *
 * A reply that hands over the code counts too (the route appends "30% off"),
 * so a visitor who types an email before being offered still counts as
 * offered, and `discount_unlocked` can never exceed `discount_offered`.
 */
export function isFirstOffer(
  history: { role: string; content: string }[],
  reply: string
): boolean {
  return (
    OFFER.test(reply) &&
    !history.some((m) => m.role === "assistant" && OFFER.test(m.content))
  );
}

export function discountCode(): string | undefined {
  return process.env.DISCOUNT_CODE_EN?.trim() || undefined;
}

/**
 * Validate the email, put it on the English list, and hand back the code.
 *
 * The code is given once the email is VALID, even if Resend then fails. The
 * visitor kept their side of the deal; a Resend outage is ours, and
 * `addBuyer` already logs the address on failure so it can be added by hand.
 * The only refusal is an address that is not an address.
 *
 * WHY RESEND BEING DOWN CAN NEVER STRAND A VISITOR: the code is shown IN THE
 * CHAT, from the env var, and is never emailed. Resend only decides whether
 * they join the list. So the one thing the tool result changes on a failure
 * is that the model must not promise emails about new templates — they are
 * not on the list, so none would come. `listFailed` is what /stats counts.
 *
 * SOMEONE ALREADY ON THE LIST (a Polar buyer, or a second chat) gets the code
 * again, with the exact same reply. Decided W7-T4: Polar enforces "once per
 * customer" at checkout, so a repeat costs nothing, and a different reply
 * would tell whoever typed the address that it bought from Wael — which is
 * not ours to confirm to a stranger in a chat box.
 *
 * An address that previously UNSUBSCRIBED still gets the code and stays
 * unsubscribed — `addBuyer` never resubscribes anyone.
 */
export async function unlockDiscount(input: unknown): Promise<Unlock> {
  const { email, template } = (input ?? {}) as { email?: unknown; template?: unknown };
  const code = discountCode();

  if (!isEmail(email)) {
    return {
      ok: false,
      metric: "discount_bad_email",
      result:
        "That is not a valid email address, so nothing was saved and there is no code yet. Ask the visitor, in one short sentence, to check it and type it again. Do not give or hint at any code.",
    };
  }

  if (!code) {
    // Loud, because the whole feature silently fails without it.
    console.error("DISCOUNT_CODE_EN is not set — the discount cannot be given.");
    return {
      ok: false,
      metric: "discount_no_code",
      result:
        "The discount code is unavailable right now because of a technical problem. Apologize in one short sentence and suggest they email Wael through the support page. Do not invent a code.",
    };
  }

  const list = await addBuyer({
    email,
    audienceId: audienceId("en"),
    list: "en",
    product: typeof template === "string" ? template.slice(0, 80) : undefined,
    source: "chat",
    orderId: "chat",
  });

  const listFailed = list === "failed" || list === "disabled";

  return {
    ok: true,
    metric: "discount_unlocked",
    code,
    list,
    listFailed,
    result: `The discount code is ${code}. Give it to the visitor now in one or two short sentences: 30% off any premium template or All Access at checkout, once per customer. The code is shown here in the chat and is NOT emailed, so never say it was sent to their inbox. ${
      listFailed
        ? "Do not mention any mailing list or future emails."
        : "Mention that Wael may email them about new template releases, and every email has an unsubscribe link."
    } Do not thank them at length.`,
  };
}
