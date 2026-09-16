"use client";

import { useEffect, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

const WELCOME =
  "أهلاً بك. أنا مساعد وائل لتصميم المواقع. اسألني عن الخدمات أو الأسعار.";

const GENERIC_ERROR = "تعذر الاتصال بالمساعد. حاول مرة أخرى.";

export default function ChatWidget() {
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
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      const data: { reply?: string; error?: string } = await res.json();

      if (!res.ok || !data.reply) {
        throw new Error(data.error ?? GENERIC_ERROR);
      }

      setMessages([...history, { role: "assistant", content: data.reply }]);
    } catch {
      setError(GENERIC_ERROR);
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
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <header className="shrink-0 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          مساعد وائل
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          تصميم مواقع على فريمر
        </p>
      </header>

      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-5"
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
        "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6",
        isUser
          ? "self-end bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "self-start bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100",
      ].join(" ")}
    >
      {children}
    </div>
  );
}
