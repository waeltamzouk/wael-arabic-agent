import type { Metadata } from "next";
import AuditForm from "./AuditForm";
import SampleReport from "./SampleReport";
import { CATEGORIES, LANDING, REPORT } from "@/lib/audit/copy-ar";

// NOT INDEXED YET, ON PURPOSE (Oct 8). The Arabic in lib/audit/copy-ar.ts is a first
// draft that Wael has not reviewed, and this page is live. REMOVE the `robots` line
// below when he has approved the wording: this page is meant to be found in the end
// (the report pages under /audit/r/ stay private for good).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "افحص موقعك العربي | وائل",
  description: "أدخل عنوان موقعك واحصل على درجة من 100 مع أهم ثلاث مشاكل وطريقة إصلاحها: اللغة العربية، الجوال، السرعة، والتواصل.",
};

const ICON = "size-6 fill-none stroke-current";
const STROKE = { strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** One small icon per check. They label the five cards; they carry no data. */
function CheckIcon({ id }: { id: string }) {
  switch (id) {
    case "arabic":
      return (
        <span aria-hidden="true" className="text-2xl font-bold leading-none">
          ع
        </span>
      );
    case "mobile":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={ICON} {...STROKE}>
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
          <path d="M11 18.5h2" />
        </svg>
      );
    case "contact":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={ICON} {...STROKE}>
          <path d="M4 5.5h16v10.5H9.5L5 20v-4H4z" />
        </svg>
      );
    case "speed":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={ICON} {...STROKE}>
          <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={ICON} {...STROKE}>
          <path d="M12 2.5 4.5 5.5v6c0 4.6 3 8.4 7.5 10 4.5-1.6 7.5-5.4 7.5-10v-6z" />
          <path d="m8.8 12.2 2.2 2.2 4.2-4.4" />
        </svg>
      );
  }
}

function Tick() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0 fill-none stroke-accent" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3.5 8.5 3 3 6-6.5" />
    </svg>
  );
}

export default function AuditPage() {
  return (
    <main className="flex-1">
      {/* ---- hero: the question, the address bar, and what you will get */}
      <section className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-14 px-4 pb-20 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-16 lg:pt-24">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-6">
            <p
              className="audit-rise inline-flex w-fit items-center gap-2.5 rounded-full bg-white/[0.07] px-4 py-1.5 text-sm text-mute ring-1 ring-hair"
            >
              <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
              {LANDING.eyebrow}
            </p>
            <h1
              className="audit-rise text-[2.5rem] font-bold leading-[1.28] tracking-tight text-white sm:text-6xl sm:leading-[1.22]"
              style={{ animationDelay: "80ms" }}
            >
              {LANDING.title}
            </h1>
            <p
              className="audit-rise max-w-xl text-lg leading-9 text-mute sm:text-xl sm:leading-10"
              style={{ animationDelay: "160ms" }}
            >
              {LANDING.lead}
            </p>
          </div>

          <div className="audit-rise" style={{ animationDelay: "260ms" }}>
            <AuditForm />
          </div>

          <ul className="audit-rise flex flex-col gap-2.5 text-sm text-mute sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2" style={{ animationDelay: "340ms" }}>
            {LANDING.trust.map((line) => (
              <li key={line} className="flex items-center gap-2">
                <Tick />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="audit-rise" style={{ animationDelay: "320ms" }}>
          <SampleReport />
        </div>
      </section>

      {/* ---- what is checked, and what is not */}
      <section aria-labelledby="checks" className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="border-t border-hair pt-14">
          <h2 id="checks" className="text-3xl font-bold text-white">
            {LANDING.checksTitle}
          </h2>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Object.entries(CATEGORIES).map(([id, c]) => (
              <li key={id} className="flex flex-col gap-4 rounded-3xl bg-panel p-5 ring-1 ring-hair">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-white/[0.06] text-soft ring-1 ring-hair">
                  <CheckIcon id={id} />
                </span>
                <div>
                  <p className="text-lg font-bold text-white">{c.name}</p>
                  <p className="mt-1.5 text-[15px] leading-7 text-mute">{c.about}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 rounded-3xl border border-dashed border-hair-strong p-6 sm:p-8">
            <h3 className="text-lg font-bold text-white">{LANDING.limitsTitle}</h3>
            <p className="mt-2 max-w-3xl text-[15px] leading-8 text-mute">{REPORT.methodLimits}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
