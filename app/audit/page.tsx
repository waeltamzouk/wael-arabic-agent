import type { Metadata } from "next";
import AuditForm from "./AuditForm";
import { CATEGORIES, REPORT } from "@/lib/audit/copy-ar";

// NOT INDEXED YET, ON PURPOSE (Oct 8). The Arabic in lib/audit/copy-ar.ts is a first
// draft that Wael has not reviewed, and this page is live. REMOVE the `robots` line
// below when he has approved the wording: this page is meant to be found in the end
// (the report pages under /audit/r/ stay private for good).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "افحص موقعك العربي | وائل",
  description: "أدخل عنوان موقعك واحصل على درجة من 100 مع أهم ثلاث مشاكل وطريقة إصلاحها: اللغة العربية، الجوال، السرعة، والتواصل.",
};

export default function AuditPage() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-10 dark:bg-black sm:px-6 sm:py-14">
      <main className="flex w-full max-w-2xl flex-col gap-10">
        <header className="flex flex-col gap-3">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">وائل ويب ديزاين</p>
          <h1 className="text-3xl font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            افحص موقعك العربي في نصف دقيقة
          </h1>
          <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            نفتح موقعكم كما يفتحه العميل، ونعطيكم درجة من 100، وأهم ثلاث مشاكل مع طريقة إصلاح كل منها.
          </p>
        </header>

        <AuditForm />

        <section aria-labelledby="what-we-check" className="flex flex-col gap-4">
          <h2 id="what-we-check" className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            ماذا نفحص؟
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {Object.values(CATEGORIES).map((c) => (
              <li key={c.name} className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
                <p className="font-medium text-zinc-900 dark:text-zinc-50">{c.name}</p>
                <p className="mt-1 text-sm leading-7 text-zinc-600 dark:text-zinc-400">{c.about}</p>
              </li>
            ))}
          </ul>
          <p className="text-sm leading-7 text-zinc-500 dark:text-zinc-400">{REPORT.methodLimits}</p>
        </section>
      </main>
    </div>
  );
}
