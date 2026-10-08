// What each client's dashboard says about their assistant. Hand-written on
// purpose: no uploads, no editing UI. When Wael changes what the agent knows,
// he bumps `updated` here, and the client sees the new date.
//
// Only public facts live here (the same prices the agent already quotes on a
// public site). No keys, no client emails — the repo is PUBLIC.

import type { Site } from "@/lib/site";

export type ContentSection = {
  title: string;
  // Short plain lines: what the agent can talk about under this heading.
  items: string[];
  // YYYY-MM-DD, shown as "Last updated".
  updated: string;
};

export type ClientConfig = {
  // Shown under the logo in the sidebar.
  name: string;
  // Show the WhatsApp channel's conversations (only the Arabic site has one).
  whatsapp: boolean;
  // Show project vs template leads (only the site with the contact form).
  leadTypes: boolean;
  // Conversations included in the plan each month. A "conversation" is a
  // visitor who sent at least one message (the `started` counter).
  limit: number;
  lang: "ar" | "en";
  // The funnel steps, in order, as stored counter names (see lib/stats.ts).
  funnel: readonly string[];
  sections: ContentSection[];
};

export const CLIENT_CONFIG: Record<Site, ClientConfig> = {
  waelwebdesign: {
    name: "waelwebdesign.com",
    whatsapp: true,
    leadTypes: true,
    limit: 500,
    lang: "ar",
    funnel: ["opened", "started", "engaged", "qualified", "form_shown", "form_submitted"],
    sections: [
      {
        title: "الخدمات والأسعار",
        items: [
          "صفحة هبوط — 800 دولار",
          "موقع شركة — 1,400 دولار",
          "موقع متقدم — من 2,000 دولار",
          "تخصيص قالب — من 300 دولار",
        ],
        updated: "2026-10-01",
      },
      {
        title: "القوالب",
        items: [
          "ستة قوالب بنسختين عربية وإنجليزية",
          "ثلاثة قوالب مجانية وثلاثة بسعر 99 دولار",
          "رابط المعاينة ورابط الحصول على كل قالب",
        ],
        updated: "2026-10-01",
      },
      {
        title: "الأسئلة الشائعة",
        items: [
          "الاستخدام والتحديثات والدعم",
          "الدومين المخصص والباقة المطلوبة من فريمر",
          "الصور والخطوط المضمّنة",
        ],
        updated: "2026-10-01",
      },
      {
        title: "أسئلة التأهيل",
        items: [
          "نوع الموقع المطلوب",
          "طبيعة النشاط",
          "الميزانية التقريبية",
          "موعد الإطلاق",
          "المحتوى والهوية الموجودة",
        ],
        updated: "2026-10-01",
      },
    ],
  },
  templates: {
    name: "Wael's Framer templates",
    whatsapp: false,
    leadTypes: false,
    limit: 500,
    lang: "en",
    funnel: ["opened", "started", "engaged", "qualified", "discount_offered", "discount_unlocked"],
    sections: [
      {
        title: "Templates and prices",
        items: [
          "Six Framer templates",
          "Three free (email needed), three at $99",
          "Demo link and get-it link for each",
        ],
        updated: "2026-10-01",
      },
      {
        title: "FAQ",
        items: [
          "How delivery works (Framer Remix link)",
          "Updates, support and what is included",
          "Custom domain needs a paid Framer plan",
        ],
        updated: "2026-10-01",
      },
      {
        title: "Questions it asks",
        items: [
          "A short quiz to match the visitor to a template",
          "Email in exchange for the 30% code",
        ],
        updated: "2026-10-01",
      },
    ],
  },
};

/** Where "Request a change" goes. Wael's public WhatsApp number. */
export const WHATSAPP_URL = "https://wa.me/905377634437";
