import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { DISCOUNT_TOOL, isFirstOffer, unlockDiscount } from "@/lib/discount";
import {
  CONTACT_TOOL,
  FALLBACK_REPLY,
  MAX_TOKENS,
  MODEL,
  languageOf,
  stripMarkdown,
  systemFor,
  type ChatMessage,
} from "@/lib/agent";
import { DEFAULT_SITE, siteFromParam, siteMetric, type Site } from "@/lib/site";
import { depthMetric, record } from "@/lib/stats";
import {
  checkSize,
  clientIp,
  corsHeaders,
  isAllowedOrigin,
  rateLimit,
  type GuardFailure,
} from "@/lib/guard";

const anthropic = new Anthropic();

function isValidMessages(value: unknown): value is ChatMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
  );
}

// Every response carries the CORS headers, including the failures. A browser
// that cannot read the reply just shows the generic error instead of the real
// reason, which makes debugging the embed much harder than it needs to be.
function json(req: NextRequest, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(req) });
}

// The English site's visitor must never see an Arabic notice. `noticeEn` is
// set on the guard's own failures; anything without one gets the generic line.
const GENERIC_NOTICE_EN = "Something went wrong. Please try again.";

function refuse(req: NextRequest, failure: GuardFailure, metric: string, site: Site) {
  console.warn("Blocked /api/chat request:", failure.error);
  record(siteMetric(site, metric));
  const notice =
    site === DEFAULT_SITE ? failure.notice : failure.noticeEn ?? GENERIC_NOTICE_EN;
  return json(req, { error: failure.error, notice }, failure.status);
}

// The browser's CORS preflight. Only fires when the widget is loaded straight
// onto another origin; the iframe at /embed is same-origin and never sends one.
export async function OPTIONS(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}


export async function POST(req: NextRequest) {
  // Which site's agent this is. A QUERY PARAM rather than a body field, so it
  // is known before the body is read and even the very first refusals below
  // can answer in the right language. No param means the Arabic site, which
  // is what every existing waelwebdesign.com bubble sends, and so does an
  // unknown value — see siteFromParam.
  const site = siteFromParam(req.nextUrl.searchParams.get("site"));

  // Cheapest check first, and the only one that runs before the body is read.
  if (!isAllowedOrigin(req)) {
    return refuse(req, {
      status: 403,
      error: `Origin not allowed: ${req.headers.get("origin") ?? "(none)"}.`,
      notice: "غير مصرح.",
      noticeEn: "Not allowed.",
    }, "blocked_origin", site);
  }

  const limited = rateLimit(clientIp(req));
  if (limited) return refuse(req, limited, "blocked_rate", site);

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body." }, 400);
  }

  const messages = (body as { messages?: unknown })?.messages;

  if (!isValidMessages(messages)) {
    return json(
      req,
      {
        error:
          "Expected { messages: [{ role: 'user' | 'assistant', content: string }] }.",
      },
      400
    );
  }

  // Size caps last: they need a parsed, valid body, and they are what stop one
  // oversized conversation costing a fortune.
  const oversized = checkSize(messages);
  if (oversized) return refuse(req, oversized, "blocked_size", site);

  try {
    // Computed ONCE and used for BOTH calls in the tool loop. The second call's
    // last message is a tool_result, so recomputing it there would read the
    // wrong message and could flip the language mid-answer.
    const language = languageOf(messages, site);
    const system = systemFor(site, language);

    // One tool per site, never both. The Arabic site shows the name + phone
    // form for Wael; the English site trades an EMAIL for the discount code.
    // Keeping them apart means the English site can never show the Arabic
    // lead form, and the Arabic site can never hand out the English code.
    const tools = site === DEFAULT_SITE ? [CONTACT_TOOL] : [DISCOUNT_TOOL];

    // Funnel milestones. `depthMetric` only returns a value at exact depths a
    // conversation passes through once, so this counts each conversation once
    // per milestone without storing anything about who it was. Language is
    // recorded only at the first message, so one conversation counts once.
    //
    // Counts the VISITOR'S messages, not the array length: the widget appends
    // its own confirmation message after the contact form, which would
    // otherwise knock every later request off the odd/even step the old
    // version depended on. See depthMetric.
    const milestone = depthMetric(
      messages.filter((m) => m.role === "user").length
    );
    if (milestone) {
      record(
        siteMetric(site, milestone),
        ...(milestone === "started" ? [siteMetric(site, `lang_${language}`)] : [])
      );
    }

    const first = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools,
      messages,
    });

    let final = first;

    // Claude decided it is time to ask for contact details. Nothing is emailed
    // here — the route tells the widget to show the form, and the form posts
    // to /api/lead when the visitor sends it.
    const toolUse = first.content.find((block) => block.type === "tool_use");
    const isForm = toolUse?.name === CONTACT_TOOL.name;

    // The English site's email-for-code step. Runs HERE, on the server, before
    // Claude writes a word: the code only exists in the tool result, so Claude
    // cannot give it out until an email has actually been saved.
    const unlock =
      toolUse?.name === DISCOUNT_TOOL.name
        ? await unlockDiscount(toolUse.input)
        : null;

    if (toolUse) {
      record(
        siteMetric(site, unlock ? unlock.metric : "form_shown"),
        ...(unlock?.ok && unlock.listFailed ? [siteMetric(site, "discount_list_failed")] : [])
      );

      final = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools,
        // `tools` must stay — the API rejects a conversation containing
        // tool_use blocks when it is missing. But this call's only job is to
        // write the sentence the visitor reads, so forbid a SECOND tool call:
        // the loop is one iteration deep, so a second call would be silently
        // dropped, and a reply that is nothing but a tool_use has no text at
        // all and falls through to the canned line.
        tool_choice: { type: "none" },
        messages: [
          ...messages,
          { role: "assistant", content: first.content },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolUse.id,
                // Claude's only remaining job is the sentence above the
                // form, so tell it exactly what the visitor can now see.
                content: unlock
                  ? unlock.result
                  : "The contact form is now shown to the visitor, below your reply. Write one short sentence asking them to fill it in. Do not ask for their name or phone number in words, and do not thank them for details they have not sent yet.",
              },
            ],
          },
        ],
      });
    }

    let reply = stripMarkdown(
      final.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
    );

    // The visitor gave a valid email, so they get the code whatever Claude
    // wrote. Deterministic, same idea as stripMarkdown: a rule the model can
    // slip on is backed by code that cannot.
    if (unlock?.ok && !reply.includes(unlock.code)) {
      reply = `${reply}\n\nYour code is ${unlock.code}: 30% off any premium template or All Access at checkout.`.trim();
    }

    // The English site's twin of `form_shown`: the first time the deal is put
    // in front of the visitor. Paired with `discount_unlocked` on /stats, the
    // gap is how many people saw the offer and kept their email.
    if (site !== DEFAULT_SITE && isFirstOffer(messages, reply)) {
      record(siteMetric(site, "discount_offered"));
    }

    // The widget throws on an empty reply, so never return one.
    return json(req, {
      reply:
        reply || FALLBACK_REPLY[isForm ? "form" : "plain"][language],
      // Present ONLY when the form should appear. `notes` is what Claude
      // gathered from the conversation; it rides out to the browser and comes
      // back with the form, and /api/lead re-checks every field of it, because
      // by then it has been through a stranger's browser.
      ...(isForm
        ? { contactForm: { language, notes: toolUse.input } }
        : {}),
    });
  } catch (error) {
    console.error("Anthropic API error:", error);

    if (error instanceof Anthropic.APIError) {
      return json(req, { error: error.message }, error.status ?? 500);
    }

    return json(req, { error: "Something went wrong talking to Claude." }, 500);
  }
}
