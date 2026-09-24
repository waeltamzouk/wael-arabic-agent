"use client";

import { useEffect, useRef, useState } from "react";
import ContactForm from "./ContactForm";
import { DEFAULT_SITE, type Site } from "@/lib/site";

type Message = {
  role: "user" | "assistant";
  content: string;
};

// The contact form's state. "pending" means it is on screen waiting to be
// filled; "done" means it has been sent and must never come back on its own.
type LeadState = {
  status: "pending" | "done";
  language: "ar" | "en";
  notes: Record<string, unknown>;
};

// Every visible string, per site. The Arabic set is exactly what shipped
// before the English site existed. `welcome` is shown in the browser only and
// never sent to Claude — which is why both prompts ban greeting back.
const UI = {
  waelwebdesign: {
    lang: "ar",
    dir: "rtl",
    welcome:
      "أهلاً بك. أنا مساعد وائل لتصميم المواقع. اسألني عن الخدمات أو الأسعار.",
    title: "مساعد وائل",
    subtitle: "تصميم مواقع على فريمر",
    close: "إغلاق المحادثة",
    typing: "يكتب…",
    error: "تعذر الاتصال بالمساعد. حاول مرة أخرى.",
    retry: "إعادة المحاولة",
    placeholder: "اكتب رسالتك…",
    inputLabel: "اكتب رسالتك",
    send: "إرسال",
  },
  templates: {
    lang: "en",
    dir: "ltr",
    welcome:
      "Hi, I'm Wael's template assistant. Tell me what you're building and I'll help you find the right Framer template.",
    title: "Template assistant",
    subtitle: "Framer templates by Wael",
    close: "Close chat",
    typing: "Typing…",
    error: "Couldn't reach the assistant. Please try again.",
    retry: "Try again",
    placeholder: "Type your message…",
    inputLabel: "Type your message",
    send: "Send",
  },
} as const satisfies Record<Site, Record<string, string>>;

// Same-origin by default, which is all the iframe at /embed needs. The env var
// exists for the day the widget is dropped straight onto waelwebdesign.com
// with no iframe — then it must be the full https://… Vercel URL, and the
// CORS allowlist in lib/guard.ts is what lets it through.
const CHAT_ENDPOINT = process.env.NEXT_PUBLIC_CHAT_API_URL || "/api/chat";

// Derived rather than given its own env var: the two routes always live on the
// same origin, so a second variable could only ever be set wrong. This handles
// both "/api/chat" and a full "https://….vercel.app/api/chat".
const LEAD_ENDPOINT = CHAT_ENDPOINT.replace(/\/api\/chat$/, "/api/lead");

// What the assistant says once the form has been sent. It is pushed into the
// conversation as a REAL assistant message, not a separate success card, and
// that is load-bearing: the whole history goes back to Claude on the next
// turn, so this is how Claude knows the details have already arrived and does
// not ask for them a second time.
const LEAD_SENT_MESSAGE = {
  ar: "تم استلام بياناتك وإرسالها لوائل. بيتواصل معك قريباً.",
  en: "Your details have been sent to Wael. He will be in touch shortly.",
} as const;

// Tells the Framer launcher to close the panel. The X lives inside the iframe,
// but the panel is shown and hidden by the parent page, so it has to ask.
export const CLOSE_MESSAGE = "wael-chat:close";

type Props = {
  // "card"  — the bordered box on the marketing homepage.
  // "panel" — edge to edge inside the iframe, with a close button.
  variant?: "card" | "panel";
  // Which site's agent this panel talks to. Sent to /api/chat as `?site=`.
  site?: Site;
};

// Links now open in the SAME tab, which destroys this component and its state.
// Without persistence the visitor comes back to an empty chat, so the whole
// point of same-tab links is lost. sessionStorage is the right scope: it
// survives navigation and the back button, and clears when the tab closes, so
// a shared computer never shows the last person's conversation.
//
// Keys are per site, so a visitor who has both sites open never sees one
// agent's conversation in the other. The Arabic keys are unchanged, so live
// conversations on waelwebdesign.com survive the deploy that added this.
function storageKey(site: Site) {
  return site === DEFAULT_SITE ? "wael-chat:messages" : `wael-chat:${site}:messages`;
}

// A SEPARATE key, not a new field on the messages. Conversations saved by the
// previous version still load unchanged, and `isMessage` stays the one shape
// check for the list.
function leadKey(site: Site) {
  return site === DEFAULT_SITE ? "wael-chat:lead" : `wael-chat:${site}:lead`;
}

function isMessage(value: unknown): value is Message {
  return (
    typeof value === "object" &&
    value !== null &&
    ((value as Message).role === "user" ||
      (value as Message).role === "assistant") &&
    typeof (value as Message).content === "string"
  );
}

function isLeadState(value: unknown): value is LeadState {
  const lead = value as LeadState | null;
  return (
    typeof lead === "object" &&
    lead !== null &&
    (lead.status === "pending" || lead.status === "done") &&
    (lead.language === "ar" || lead.language === "en") &&
    typeof lead.notes === "object" &&
    lead.notes !== null
  );
}

function loadLead(site: Site): LeadState | null {
  try {
    const raw = sessionStorage.getItem(leadKey(site));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isLeadState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadMessages(site: Site): Message[] {
  // Every access is wrapped: storage throws outright in some privacy modes,
  // and a third-party iframe can be denied it entirely.
  try {
    const raw = sessionStorage.getItem(storageKey(site));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isMessage) : [];
  } catch {
    return [];
  }
}

export default function ChatWidget({ variant = "card", site = DEFAULT_SITE }: Props) {
  const isPanel = variant === "panel";
  const t = UI[site];
  // No param for the Arabic site, so its requests are byte-for-byte what they
  // were before the English site existed.
  const chatUrl =
    site === DEFAULT_SITE ? CHAT_ENDPOINT : `${CHAT_ENDPOINT}?site=${site}`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lead, setLead] = useState<LeadState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const toBottom = () => {
      el.scrollTop = el.scrollHeight;
    };

    toBottom();

    // The Arabic webfont swaps in AFTER this runs and reflows every bubble
    // taller, which on a restored conversation leaves the view hundreds of
    // pixels short of the bottom — the same symptom as not scrolling at all.
    // Re-pin once the font is actually in.
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) toBottom();
    });

    return () => {
      cancelled = true;
    };
  }, [messages, loading, error, lead]);

  // Restore after mount, not in a useState initializer: the server renders an
  // empty list, so reading storage during the first render is a hydration
  // mismatch.
  useEffect(() => {
    const restored = loadMessages(site);
    if (restored.length) setMessages(restored);
    const restoredLead = loadLead(site);
    if (restoredLead) setLead(restoredLead);
  }, [site]);

  useEffect(() => {
    // Never write an empty list. On mount this effect runs BEFORE the restore
    // above has applied its state, so saving [] here would erase the very
    // conversation we are trying to bring back.
    if (messages.length === 0) return;
    try {
      sessionStorage.setItem(storageKey(site), JSON.stringify(messages));
    } catch {
      // Storage blocked. The chat still works, it just will not survive a
      // same-tab navigation.
    }
  }, [messages, site]);

  useEffect(() => {
    try {
      // Unlike the message list, null is a real state worth writing: it is how
      // a dismissed form stays dismissed across a page change.
      if (lead) sessionStorage.setItem(leadKey(site), JSON.stringify(lead));
      else sessionStorage.removeItem(leadKey(site));
    } catch {
      // Storage blocked. The form still works, it just will not survive a
      // same-tab navigation.
    }
  }, [lead, site]);

  async function sendHistory(history: Message[]) {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      const data: {
        reply?: string;
        error?: string;
        notice?: string;
        contactForm?: { language: "ar" | "en"; notes: Record<string, unknown> };
      } = await res.json();

      if (!res.ok || !data.reply) {
        // `notice` is written for the visitor and is safe to show. `error` is
        // for the logs and can be raw English from the API, so it never is.
        throw new Error(data.notice ?? t.error);
      }

      setMessages([...history, { role: "assistant", content: data.reply }]);

      // Only ever set by the route, and only on the turn Claude asked for it.
      if (data.contactForm) {
        setLead({ status: "pending", ...data.contactForm });
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t.error);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    void sendHistory(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function handleLeadSent() {
    if (!lead) return;
    // Pushed as a normal assistant message so it is saved, restored and sent
    // back to Claude like any other turn — see LEAD_SENT_MESSAGE.
    setMessages((current) => [
      ...current,
      { role: "assistant", content: LEAD_SENT_MESSAGE[lead.language] },
    ]);
    setLead({ ...lead, status: "done" });
  }

  const canRetry =
    !loading && messages.length > 0 && messages[messages.length - 1].role === "user";

  return (
    <div
      // The root layout is <html lang="ar" dir="rtl">, shared by every page,
      // so the English panel sets its own direction here. `data-site` picks
      // the site's accent colour in globals.css.
      lang={t.lang}
      dir={t.dir}
      data-site={site}
      className={[
        // `min-h-0 flex-1` for BOTH variants, never `h-full`. A percentage
        // height needs a parent with a DEFINITE height, and neither parent
        // has one — `body` carries only `min-height`, and the homepage
        // wrapper only `max-height`. `h-full` silently became "as tall as my
        // content", which stopped the message list scrolling and pushed the
        // composer off screen. `min-h-0` is the half that lets it shrink.
        "flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-950",
        // Rounding is omitted in the panel: it belongs to the iframe itself,
        // on the Framer side, and doubling it shows a corner seam.
        isPanel
          ? ""
          : "rounded-2xl border border-zinc-200 dark:border-zinc-800",
      ].join(" ")}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {t.title}
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {t.subtitle}
          </p>
        </div>

        {isPanel && (
          <button
            type="button"
            onClick={() =>
              // "*" is fine here: the message carries no data, and the parent
              // checks the iframe's origin before acting on it.
              window.parent?.postMessage({ type: CLOSE_MESSAGE }, "*")
            }
            aria-label={t.close}
            className="-me-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        )}
      </header>

      <div
        ref={scrollRef}
        // GOTCHA: `min-h-0` is what makes this scroll at all. A flex item
        // defaults to `min-height: auto`, which refuses to shrink below its
        // content, so `flex-1` + `overflow-y-auto` GROWS the list past the
        // iframe instead of scrolling it — and pushes the composer off
        // screen. Invisible until a conversation is long enough to overflow,
        // which is why a restored conversation exposed it first.
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-5 py-5"
      >
        <Bubble role="assistant">{t.welcome}</Bubble>

        {messages.map((m, i) => (
          <Bubble key={i} role={m.role}>
            {m.content}
          </Bubble>
        ))}

        {lead?.status === "pending" && !loading && (
          <ContactForm
            // Remounts on a fresh request, so a form offered a second time
            // never shows the last attempt's half-filled fields.
            key={JSON.stringify(lead.notes)}
            language={lead.language}
            notes={lead.notes}
            endpoint={LEAD_ENDPOINT}
            onSent={handleLeadSent}
            onDismiss={() => setLead(null)}
          />
        )}

        {loading && (
          <div className="self-start rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            {t.typing}
          </div>
        )}

        {error && (
          <div className="self-start rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
            {canRetry && (
              <button
                type="button"
                onClick={() => void sendHistory(messages)}
                className="ms-2 font-medium underline underline-offset-2"
              >
                {t.retry}
              </button>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-end gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          dir="auto"
          placeholder={t.placeholder}
          aria-label={t.inputLabel}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-accent dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500"
        />
        <button
          type="submit"
          disabled={loading || input.trim().length === 0}
          className="h-11 shrink-0 rounded-xl bg-accent px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {t.send}
        </button>
      </form>
    </div>
  );
}

// One capture group, so String.split() returns [text, url, text, url, …] and
// every ODD index is a URL. Trailing punctuation is excluded so a link at the
// end of an Arabic sentence does not swallow the full stop.
const URL_PATTERN = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?؟،])/g;

function linkify(text: string) {
  return text.split(URL_PATTERN).map((part, i) => {
    if (i % 2 === 0) return part;

    return (
      <a
        key={i}
        href={part}
        // "_top" and NOT "_self". The widget runs inside an iframe, so
        // "_self" would load the destination INSIDE the 380px panel — and
        // Polar and Framer both refuse to be framed, so it would just break.
        // "_top" navigates the whole tab, which is what "same tab" means.
        // Allowed cross-origin because it happens on a real user click.
        target="_top"
        // dir="ltr" is not cosmetic. Inside RTL Arabic, a bare URL gets
        // reordered by the bidi algorithm and its trailing slash jumps to the
        // FRONT — the visitor sees "/https://heddah.framer.website". The dir
        // attribute isolates it so it reads correctly.
        dir="ltr"
        // Polar checkout links are ~70 unbroken characters. Without break-all
        // they overflow the bubble and force the whole panel to scroll
        // sideways. inline-block keeps the wrapped lines together.
        className="inline-block break-all text-accent-text underline underline-offset-2 [unicode-bidi:isolate]"
      >
        {part}
      </a>
    );
  });
}

function Bubble({
  role,
  children,
}: {
  role: "user" | "assistant";
  children: React.ReactNode;
}) {
  const isUser = role === "user";

  return (
    <div
      dir="auto"
      className={[
        "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-6",
        isUser
          ? "self-end bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "self-start bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100",
      ].join(" ")}
    >
      {typeof children === "string" ? linkify(children) : children}
    </div>
  );
}
