"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

// Same field look as app/components/ContactForm.tsx, so the audit page and the chat
// form read as one site.
const FIELD =
  "w-full rounded-xl bg-white px-3 py-3 text-base text-zinc-900 outline-none ring-1 ring-zinc-200 focus:ring-2 focus:ring-accent aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500 dark:bg-zinc-950 dark:text-zinc-50 dark:ring-zinc-800";
const LABEL = "mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300";
const ERROR = "mt-1 text-sm text-red-700 dark:text-red-400";

type Field = "website" | "name" | "email" | "consent";

export default function AuditForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<{ field?: Field; message: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFieldError(null);

    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website: data.get("website"),
          name: data.get("name"),
          email: data.get("email"),
          consent: data.get("consent") === "on",
          // The honeypot. Empty for a person; a bot that fills every field fills it.
          company_site: data.get("company_site"),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; notice?: string; field?: Field };

      if (res.status === 202 && body.id) {
        router.push(`/audit/r/${body.id}`);
        return; // keep the button disabled while the next page loads
      }
      setFieldError({ field: body.field, message: body.notice ?? "تعذّر بدء الفحص. حاولوا مرة أخرى." });
    } catch {
      setFieldError({ message: "تعذّر الاتصال. تأكدوا من الإنترنت وحاولوا مرة أخرى." });
    }
    setBusy(false);
  }

  const err = (field: Field) => (fieldError?.field === field ? fieldError.message : null);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-2xl bg-zinc-100 p-5 dark:bg-zinc-900 sm:p-6">
      <div>
        <label htmlFor="audit-website" className={LABEL}>
          عنوان موقعكم
        </label>
        <input
          id="audit-website"
          name="website"
          type="text"
          inputMode="url"
          dir="ltr"
          autoComplete="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          placeholder="example.com.sa"
          aria-invalid={Boolean(err("website"))}
          aria-describedby={err("website") ? "audit-website-error" : undefined}
          className={FIELD}
        />
        {err("website") && (
          <p id="audit-website-error" role="alert" className={ERROR}>
            {err("website")}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="audit-name" className={LABEL}>
            الاسم
          </label>
          <input
            id="audit-name"
            name="name"
            type="text"
            autoComplete="name"
            required
            aria-invalid={Boolean(err("name"))}
            aria-describedby={err("name") ? "audit-name-error" : undefined}
            className={FIELD}
          />
          {err("name") && (
            <p id="audit-name-error" role="alert" className={ERROR}>
              {err("name")}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="audit-email" className={LABEL}>
            البريد الإلكتروني
          </label>
          <input
            id="audit-email"
            name="email"
            type="email"
            dir="ltr"
            autoComplete="email"
            autoCapitalize="none"
            required
            aria-invalid={Boolean(err("email"))}
            aria-describedby={err("email") ? "audit-email-error" : undefined}
            className={FIELD}
          />
          {err("email") && (
            <p id="audit-email-error" role="alert" className={ERROR}>
              {err("email")}
            </p>
          )}
        </div>
      </div>

      {/* The honeypot: out of sight and out of the tab order. Positioned off screen
          instead of display:none, because bots skip fields that are not rendered. */}
      <div aria-hidden="true" style={{ position: "absolute", insetInlineStart: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="audit-company-site">Leave this field empty</label>
        <input id="audit-company-site" name="company_site" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <label className="flex items-start gap-3 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
          <input
            name="consent"
            type="checkbox"
            required
            aria-invalid={Boolean(err("consent"))}
            aria-describedby={err("consent") ? "audit-consent-error" : undefined}
            className="mt-2 size-4 shrink-0 accent-accent"
          />
          <span>
            أوافق على أن يرسل لي وائل ويب ديزاين تقرير الفحص، وأن يراسلني أحياناً بنصائح وعروض تخص مواقع الشركات. يمكنني إلغاء الاشتراك في أي وقت.
          </span>
        </label>
        {err("consent") && (
          <p id="audit-consent-error" role="alert" className={ERROR}>
            {err("consent")}
          </p>
        )}
      </div>

      {fieldError && !fieldError.field && (
        <p role="alert" className={ERROR}>
          {fieldError.message}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="h-12 rounded-xl bg-accent px-5 text-base font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "جارٍ البدء…" : "افحص موقعي"}
      </button>

      <p className="text-xs leading-6 text-zinc-500 dark:text-zinc-400">
        نحفظ اسمك وبريدك في قائمة وائل البريدية فقط. يُحفظ التقرير 30 يوماً برابط خاص لا يمكن تخمينه، ولا يحتوي على بياناتك.
      </p>
    </form>
  );
}
