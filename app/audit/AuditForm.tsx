"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { FORM_UI } from "@/lib/audit/copy-ar";

// THE FORM IS TWO STEPS, and the first one is only an address bar.
//   Step 1: the website, drawn as the address bar of a browser. One field, one button: the
//           smallest possible first commitment. The address is also the thing being measured,
//           so the field IS the subject of the page.
//   Step 2: opens below once the address looks like one: name, email, the consent box.
// It is one <form> throughout (Enter in step 1 moves on instead of submitting).

type Field = "website" | "name" | "email" | "consent";

const INPUT =
  "w-full rounded-2xl bg-white/[0.06] px-4 py-3.5 text-base text-white outline-none ring-1 ring-hair placeholder:text-faint focus:ring-2 focus:ring-accent aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-400";
const LABEL = "mb-1.5 block text-sm font-medium text-mute";
const ERROR = "mt-2 flex items-start gap-2 text-sm leading-6 text-red-300";

// Wael's test switch (lib/test-mode.ts), the same one the chat widget has.
// `/audit?test=<STATS_KEY>` turns it on for this tab, `?test=off` turns it off. The key is kept in
// sessionStorage and only ever travels as the `x-test-key` header. A test is not counted in the
// stats and its emails start with [TEST]. It is NOT a dry run: the report email, the notice to
// Wael and the Resend list-add all still happen, which is why the banner says so.
const TEST_KEY_STORAGE = "wael-audit:test";

function loadTestKey(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("test")?.trim();
    if (fromUrl === "off") {
      sessionStorage.removeItem(TEST_KEY_STORAGE);
      return null;
    }
    if (fromUrl) {
      sessionStorage.setItem(TEST_KEY_STORAGE, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(TEST_KEY_STORAGE);
  } catch {
    return null;
  }
}

// useSyncExternalStore is how React reads browser-only state without a hydration mismatch: the
// server (and the first render) get `null`, the browser then gets the real value. Nothing here
// changes while the page is open, so there is nothing to subscribe to.
const noSubscription = () => () => {};

// The hidden anti-bot field. Its first version was named `company_site`, and a real browser
// AUTOFILLED it, so the server took the owner for a bot three times in a row and quietly threw
// the audit away. The name now says nothing a browser or a password manager recognises, and the
// server no longer blocks on this field alone: it also needs the form to have been submitted
// impossibly fast (see app/api/audit/route.ts).
const HONEYPOT = "x_hp_8f3a";

/** Does this look like a web address? Only a first check: the server is the one that decides. */
function looksLikeAddress(raw: string): boolean {
  const value = raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  return /^[^\s/@]+\.[^\s/@]{2,}(\/\S*)?$/.test(value);
}

function Lock() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-5 shrink-0 fill-none stroke-current" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

function Alert({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <p id={id} role="alert" className={ERROR}>
      <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-1 size-4 shrink-0 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 5v3.4M8 10.8v.01" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

export default function AuditForm() {
  const router = useRouter();
  const testKey = useSyncExternalStore(noSubscription, loadTestKey, () => null);
  // null = not asked yet. The banner only appears once the SERVER has said whether the key is real.
  const [testValid, setTestValid] = useState<boolean | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field?: Field; message: string } | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // When the form appeared. A person takes seconds; a bot posts in milliseconds.
  const shownAt = useRef(0);

  useEffect(() => {
    shownAt.current = Date.now();
  }, []);

  // Ask the server whether the test key is the real one. State is only set in the answer's
  // callback, never synchronously in the effect.
  useEffect(() => {
    if (!testKey) return;
    let cancelled = false;
    fetch("/api/audit/test-key", { headers: { "x-test-key": testKey }, cache: "no-store" })
      .then((res) => res.json())
      .then((body: { valid?: boolean }) => !cancelled && setTestValid(body.valid === true))
      .catch(() => !cancelled && setTestValid(false));
    return () => {
      cancelled = true;
    };
  }, [testKey]);

  useEffect(() => {
    if (step === 2) nameRef.current?.focus();
  }, [step]);

  const testOn = Boolean(testKey) && testValid === true;
  const testWrong = Boolean(testKey) && testValid === false;

  function goToStep2() {
    const value = urlRef.current?.value ?? "";
    if (!looksLikeAddress(value)) {
      setProblem({ field: "website", message: FORM_UI.urlError });
      urlRef.current?.focus();
      return;
    }
    setProblem(null);
    setStep(2);
  }

  function backToStep1() {
    setStep(1);
    setProblem(null);
    requestAnimationFrame(() => urlRef.current?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (step === 1) return goToStep2();
    setProblem(null);

    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(testOn && testKey ? { "x-test-key": testKey } : {}) },
        body: JSON.stringify({
          website: data.get("website"),
          name: data.get("name"),
          email: data.get("email"),
          consent: data.get("consent") === "on",
          // The honeypot. Empty for a person; a bot that fills every field fills it.
          [HONEYPOT]: data.get(HONEYPOT),
          // Milliseconds the form was open. The server only blocks a filled honeypot when this is tiny.
          t: shownAt.current ? Date.now() - shownAt.current : null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; notice?: string; field?: Field };

      if (res.status === 202 && body.id) {
        router.push(`/audit/r/${body.id}`);
        return; // keep the button disabled while the next page loads
      }
      // A refused address belongs back in step 1, where the address is.
      if (body.field === "website") setStep(1);
      setProblem({ field: body.field, message: body.notice ?? FORM_UI.failed });
    } catch {
      setProblem({ message: FORM_UI.offline });
    }
    setBusy(false);
  }

  const err = (field: Field) => (problem?.field === field ? problem.message : null);

  return (
    <form onSubmit={submit} noValidate className="flex w-full flex-col gap-4">
      {(testOn || testWrong) && (
        <p
          role="status"
          className={`rounded-2xl px-4 py-3 text-sm leading-7 ring-1 ${
            testOn ? "bg-amber-400/10 text-amber-200 ring-amber-400/30" : "bg-red-400/10 text-red-200 ring-red-400/30"
          }`}
        >
          {testOn ? FORM_UI.testOn : FORM_UI.testWrong}
        </p>
      )}

      {/* ---- step 1: the address bar. dir="ltr" because a web address reads left to right. */}
      <div>
        <label htmlFor="audit-website" className="sr-only">
          {FORM_UI.urlLabel}
        </label>
        <div
          dir="ltr"
          className={`flex items-center gap-2 rounded-full bg-raised p-1.5 ps-5 ring-1 transition-shadow focus-within:ring-2 focus-within:ring-accent ${
            err("website") ? "ring-2 ring-red-400" : "ring-hair-strong"
          }`}
        >
          <span className="text-mute">
            <Lock />
          </span>
          <input
            ref={urlRef}
            id="audit-website"
            name="website"
            type="text"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            placeholder={FORM_UI.urlPlaceholder}
            aria-invalid={Boolean(err("website"))}
            aria-describedby={err("website") ? "audit-website-error" : undefined}
            className="min-w-0 flex-1 bg-transparent py-3 font-mono text-base text-white outline-none placeholder:text-faint sm:text-lg"
          />
          {step === 1 && (
            <button
              type="submit"
              className="h-12 shrink-0 rounded-full bg-accent px-7 text-base font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:px-9"
            >
              {FORM_UI.urlButton}
            </button>
          )}
        </div>
        {err("website") && <Alert id="audit-website-error">{err("website")}</Alert>}
      </div>

      {/* ---- step 2 opens below. `inert` keeps it out of the tab order while closed. */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-500 ease-out motion-reduce:transition-none ${
          step === 2 ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden" inert={step !== 2}>
          <div className="mt-2 flex flex-col gap-5 rounded-3xl bg-panel p-5 ring-1 ring-hair sm:p-7">
            <div>
              <h2 className="text-xl font-bold text-white">{FORM_UI.step2Title}</h2>
              <p className="mt-1 text-[15px] leading-7 text-mute">{FORM_UI.step2Lead}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="audit-name" className={LABEL}>
                  {FORM_UI.name}
                </label>
                <input
                  ref={nameRef}
                  id="audit-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  aria-invalid={Boolean(err("name"))}
                  aria-describedby={err("name") ? "audit-name-error" : undefined}
                  className={INPUT}
                />
                {err("name") && <Alert id="audit-name-error">{err("name")}</Alert>}
              </div>
              <div>
                <label htmlFor="audit-email" className={LABEL}>
                  {FORM_UI.email}
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
                  className={`${INPUT} text-left`}
                />
                {err("email") && <Alert id="audit-email-error">{err("email")}</Alert>}
              </div>
            </div>

            {/* The honeypot: out of sight and out of the tab order. Positioned off screen instead of
                display:none, because bots skip fields that are not rendered. The data-* attributes
                tell the common password managers (LastPass, 1Password, Bitwarden) to leave it alone;
                the neutral name does the same for the browser. */}
            <div aria-hidden="true" style={{ position: "absolute", insetInlineStart: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
              <label htmlFor="audit-hp">Leave this field empty</label>
              <input
                id="audit-hp"
                name={HONEYPOT}
                type="text"
                tabIndex={-1}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                data-form-type="other"
              />
            </div>

            <div>
              <label className="flex cursor-pointer items-start gap-3 text-sm leading-7 text-mute">
                <input
                  name="consent"
                  type="checkbox"
                  required
                  aria-invalid={Boolean(err("consent"))}
                  aria-describedby={err("consent") ? "audit-consent-error" : undefined}
                  className="mt-2 size-4 shrink-0 accent-accent"
                />
                <span>{FORM_UI.consent}</span>
              </label>
              {err("consent") && <Alert id="audit-consent-error">{err("consent")}</Alert>}
            </div>

            {problem && !problem.field && <Alert>{problem.message}</Alert>}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="submit"
                disabled={busy}
                className="h-14 flex-1 rounded-full bg-accent px-8 text-base font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40"
              >
                {busy ? FORM_UI.submitting : FORM_UI.submit}
              </button>
              <button
                type="button"
                onClick={backToStep1}
                className="h-12 rounded-full px-6 text-[15px] text-mute underline underline-offset-4 transition-colors hover:text-white"
              >
                {FORM_UI.back}
              </button>
            </div>

            <p className="text-xs leading-6 text-faint">{FORM_UI.privacy}</p>
          </div>
        </div>
      </div>
    </form>
  );
}
