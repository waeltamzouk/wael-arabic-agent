"use client";

import { useEffect, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

const WELCOME =
  "أهلاً بك. أنا مساعد وائل لتصميم المواقع. اسألني عن الخدمات أو الأسعار.";

const GENERIC_ERROR = "تعذر الاتصال بالمساعد. حاول مرة أخرى.";

// Same-origin by default, which is all the iframe at /embed needs. The env var
// exists for the day the widget is dropped straight onto waelwebdesign.com
// with no iframe — then it must be the full https://… Vercel URL, and the
// CORS allowlist in lib/guard.ts is what lets it through.
const CHAT_ENDPOINT = process.env.NEXT_PUBLIC_CHAT_API_URL || "/api/chat";

// Tells the Framer launcher to close the panel. The X lives inside the iframe,
// but the panel is shown and hidden by the parent page, so it has to ask.
export const CLOSE_MESSAGE = "wael-chat:close";

type Props = {
  // "card"  — the bordered box on the marketing homepage.
  // "panel" — edge to edge inside the iframe, with a close button.
  variant?: "card" | "panel";
};

export default function ChatWidget({ variant = "card" }: Props) {
  const isPanel = variant === "panel";
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, error]);

  async function sendHistory(history: Message[]) {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      const data: { reply?: string; error?: string; notice?: string } =
        await res.json();

      if (!res.ok || !data.reply) {
        // `notice` is written for the visitor and is safe to show. `error` is
        // for the logs and can be raw English from the API, so it never is.
        throw new Error(data.notice ?? GENERIC_ERROR);
      }

      setMessages([...history, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : GENERIC_ERROR);
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

  const canRetry =
    !loading && messages.length > 0 && messages[messages.length - 1].role === "user";

  return (
    <div
      className={[
        "flex flex-col overflow-hidden bg-white dark:bg-zinc-950",
        // GOTCHA: `h-full` collapses to content height here. `body` only has
        // min-height, so a percentage height has nothing definite to resolve
        // against. `flex-1` fills the iframe properly; `min-h-0` lets the
        // message list scroll instead of pushing the composer off-screen.
        // The card keeps `h-full` — its parent on the homepage is sized.
        // Rounding is omitted in the panel: it belongs to the iframe itself,
        // on the Framer side, and doubling it shows a corner seam.
        isPanel
          ? "min-h-0 flex-1"
          : "h-full rounded-2xl border border-zinc-200 dark:border-zinc-800",
      ].join(" ")}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            مساعد وائل
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            تصميم مواقع على فريمر
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
            aria-label="إغلاق المحادثة"
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
        className="flex flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-5 py-5"
      >
        <Bubble role="assistant">{WELCOME}</Bubble>

        {messages.map((m, i) => (
          <Bubble key={i} role={m.role}>
            {m.content}
          </Bubble>
        ))}

        {loading && (
          <div className="self-start rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            يكتب…
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
                إعادة المحاولة
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
          placeholder="اكتب رسالتك…"
          aria-label="اكتب رسالتك"
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-zinc-900 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-100"
        />
        <button
          type="submit"
          disabled={loading || input.trim().length === 0}
          className="h-11 shrink-0 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          إرسال
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
        target="_blank"
        rel="noopener noreferrer"
        // dir="ltr" is not cosmetic. Inside RTL Arabic, a bare URL gets
        // reordered by the bidi algorithm and its trailing slash jumps to the
        // FRONT — the visitor sees "/https://heddah.framer.website". The dir
        // attribute isolates it so it reads correctly.
        dir="ltr"
        // Polar checkout links are ~70 unbroken characters. Without break-all
        // they overflow the bubble and force the whole panel to scroll
        // sideways. inline-block keeps the wrapped lines together.
        className="inline-block break-all underline underline-offset-2 [unicode-bidi:isolate]"
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
