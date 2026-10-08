// Every word the client dashboard shows, in the client's language. Its own
// plain module (no "use client") so the server page and the interactive
// component can both import it.

export type Lang = "ar" | "en";

type Copy = {
  title: string;
  month: string;
  note: string;
  near: string;
  over: string;
  lastMonthSame: string;
  lastMonthTotal: string;
  projected: (n: string) => string;
  ranges: { "7": string; "30": string; month: string };
  rangeLabel: string;
  funnel: string;
  funnelHint: string;
  ofPrevious: (pct: string) => string;
  fewer: (n: string) => string;
  chart: string;
  chartHint: string;
  noConversations: string;
  max: string;
  avg: string;
  perDay: string;
  busiest: string;
  none: string;
  ofConversations: (pct: string) => string;
  language: string;
  arabic: string;
  english: string;
  content: string;
  contentHint: string;
  updated: string;
  items: (n: number) => string;
  try: string;
  change: string;
  refresh: string;
  refreshing: string;
  numbersAt: (time: string) => string;
  unavailable: string;
  live: string;
  channelsTitle: string;
  channelWebsite: string;
  channelWhatsapp: string;
  startersTitle: string;
  startersHint: string;
  leadTypesTitle: string;
  leadProject: string;
  leadTemplate: string;
  weekdayTitle: string;
  weekdayBasis: string;
  weekdayOne: (a: string) => string;
  weekdayTwo: (a: string, b: string) => string;
  weekdayEven: string;
  weekdayFew: string;
  nav: { overview: string; journey: string; activity: string; content: string };
  cardTitle: string;
  cardText: string;
  collapse: string;
  expand: string;
  vsPrior: string;
  insight: (used: number, change: number | null) => { pre: string; strong: string; post: string };
  calendarHint: string;
  less: string;
  more: string;
  pickDay: string;
  colConv: string;
  usedLabel: string;
  remainingLabel: string;
  tabs: string;
  empty: string;
  usedPct: (pct: string) => string;
  steps: Record<string, string>;
  stepHelp: Record<string, string>;
  whatsapp: (site: string) => string;
};

export const TEXT: Record<Lang, Copy> = {
  ar: {
    title: "لوحة المساعد",
    month: "محادثات هذا الشهر",
    note: "المحادثة = زائر أرسل رسالة واحدة على الأقل.",
    near: "اقتربت من عدد المحادثات المضمّنة في باقتك.",
    over: "تجاوزت عدد المحادثات المضمّنة في باقتك. مساعدك يعمل كالمعتاد.",
    lastMonthSame: "الشهر الماضي في نفس الفترة",
    lastMonthTotal: "إجمالي الشهر الماضي",
    projected: (n) => `بهذا المعدل ستصل إلى حوالي ${n} محادثة بنهاية الشهر.`,
    ranges: { "7": "7 أيام", "30": "30 يوماً", month: "هذا الشهر" },
    rangeLabel: "الفترة",
    funnel: "رحلة الزوار",
    funnelHint: "اضغط على أي خطوة لتفهمها.",
    ofPrevious: (pct) => `${pct} من الخطوة السابقة`,
    fewer: (n) => `${n} أقل من الخطوة السابقة`,
    chart: "المحادثات في كل يوم",
    chartHint: "اضغط على أي عمود لترى تفاصيل ذلك اليوم.",
    noConversations: "لا توجد محادثات في هذا اليوم.",
    max: "الأعلى",
    avg: "المتوسط اليومي",
    perDay: "محادثة في اليوم",
    busiest: "أكثر الأيام نشاطاً",
    none: "—",
    ofConversations: (pct) => `${pct} من المحادثات`,
    language: "لغة الزوار",
    arabic: "عربي",
    english: "إنجليزي",
    content: "ما يعرفه مساعدك",
    contentHint: "اضغط على أي قسم لترى ما بداخله.",
    updated: "آخر تحديث",
    items: (n) => `${n} عناصر`,
    try: "جرّب مساعدك",
    change: "اطلب تغييراً",
    refresh: "تحديث الأرقام",
    refreshing: "جارٍ التحديث…",
    numbersAt: (time) => `الأرقام محدّثة الساعة ${time}`,
    unavailable: "الأرقام غير متاحة الآن. حاول لاحقاً.",
    live: "يعمل الآن",
    channelsTitle: "من أين تأتي المحادثات",
    channelWebsite: "الموقع",
    channelWhatsapp: "واتساب",
    startersTitle: "بدأوا بالضغط على سؤال مقترح",
    startersHint: "زوار ضغطوا على أحد الأسئلة المقترحة بدل أن يكتبوا رسالتهم الأولى.",
    leadTypesTitle: "نوع العملاء المحتملين",
    leadProject: "مشاريع",
    leadTemplate: "قوالب",
    weekdayTitle: "أكثر أيام الأسبوع نشاطاً",
    weekdayBasis: "بناءً على آخر شهرين",
    weekdayOne: (a) => `معظم زوارك يأتون يوم ${a}.`,
    weekdayTwo: (a, b) => `معظم زوارك يأتون يومي ${a} و${b}.`,
    weekdayEven: "زوارك يأتون بشكل متوازن طوال الأسبوع.",
    weekdayFew: "لا توجد محادثات كافية بعد لرؤية نمط واضح.",
    nav: { overview: "نظرة عامة", journey: "رحلة الزوار", activity: "النشاط", content: "المحتوى" },
    cardTitle: "مساعدك",
    cardText: "جرّبه بنفسك، أو اطلب تغييراً.",
    collapse: "طي القائمة",
    expand: "فتح القائمة",
    vsPrior: "مقارنة بالفترة السابقة",
    insight: (used, change) => ({
      pre: "لديك ",
      strong: `${used} محادثة`,
      post:
        change === null
          ? " هذا الشهر حتى الآن."
          : change === 0
            ? " هذا الشهر حتى الآن، بنفس عدد الشهر الماضي في نفس الفترة."
            : ` هذا الشهر حتى الآن، أي ${Math.abs(change)}% ${change > 0 ? "أكثر" : "أقل"} من نفس الفترة الشهر الماضي.`,
    }),
    calendarHint: "كل مربع يوم. كلما كان لونه أقوى، كانت محادثاته أكثر. اضغط على أي يوم لترى تفاصيله.",
    less: "أقل",
    more: "أكثر",
    pickDay: "اضغط على أي يوم في التقويم لترى أرقامه.",
    colConv: "المحادثات",
    usedLabel: "مستخدم",
    remainingLabel: "المتبقي",
    tabs: "التنقل",
    empty: "لا توجد محادثات في هذه الفترة بعد.",
    usedPct: (pct) => `${pct} مستخدم من باقتك`,
    steps: {
      opened: "فتحوا المحادثة",
      started: "كتبوا رسالة",
      engaged: "تفاعلوا مع الأسئلة",
      qualified: "أجابوا عن الأسئلة",
      form_shown: "ظهر لهم النموذج",
      form_submitted: "أرسلوا بياناتهم",
      discount_offered: "عُرض عليهم كود الخصم",
      discount_unlocked: "حصلوا على كود الخصم",
    },
    stepHelp: {
      opened: "زوار ضغطوا على زر المحادثة وفتحوا النافذة.",
      started: "زوار كتبوا رسالة واحدة على الأقل. هذه الخطوة هي التي تُحسب من محادثات باقتك.",
      engaged: "زوار استمروا في الحديث لحوالي ثلاث رسائل، أي تجاوزوا السؤال الأول.",
      qualified: "زوار أجابوا عن معظم أسئلة المساعد (حوالي ست رسائل).",
      form_shown: "زوار ظهر لهم نموذج ترك البيانات.",
      form_submitted: "زوار أرسلوا بياناتهم إليك. هؤلاء هم عملاؤك المحتملون.",
      discount_offered: "زوار عُرض عليهم كود الخصم مقابل بريدهم الإلكتروني.",
      discount_unlocked: "زوار كتبوا بريدهم وحصلوا على كود الخصم.",
    },
    whatsapp: (site) => `مرحباً وائل، أريد تغيير شيء في مساعدي (${site}): `,
  },
  en: {
    title: "Assistant dashboard",
    month: "Conversations this month",
    note: "A conversation = a visitor who sent at least one message.",
    near: "You're close to the conversations included in your plan.",
    over: "You've gone past the conversations included in your plan. Your assistant keeps working as usual.",
    lastMonthSame: "Last month, same period",
    lastMonthTotal: "Last month, total",
    projected: (n) => `At this pace you'll reach about ${n} conversations by the end of the month.`,
    ranges: { "7": "7 days", "30": "30 days", month: "This month" },
    rangeLabel: "Period",
    funnel: "Visitor journey",
    funnelHint: "Tap a step to see what it means.",
    ofPrevious: (pct) => `${pct} of the step before`,
    fewer: (n) => `${n} fewer than the step before`,
    chart: "Conversations per day",
    chartHint: "Tap a bar to see that day.",
    noConversations: "No conversations on this day.",
    max: "Max",
    avg: "Daily average",
    perDay: "conversations a day",
    busiest: "Busiest day",
    none: "—",
    ofConversations: (pct) => `${pct} of conversations`,
    language: "Visitor language",
    arabic: "Arabic",
    english: "English",
    content: "What your assistant knows",
    contentHint: "Tap a section to see what is inside.",
    updated: "Last updated",
    items: (n) => `${n} items`,
    try: "Try your assistant",
    change: "Request a change",
    refresh: "Refresh numbers",
    refreshing: "Refreshing…",
    numbersAt: (time) => `Numbers updated at ${time}`,
    unavailable: "Numbers are not available right now. Please try again later.",
    live: "Live",
    channelsTitle: "Where conversations come from",
    channelWebsite: "Website",
    channelWhatsapp: "WhatsApp",
    startersTitle: "Started with a suggested question",
    startersHint: "Visitors who tapped one of the suggested questions instead of typing their first message.",
    leadTypesTitle: "Leads by type",
    leadProject: "Projects",
    leadTemplate: "Templates",
    weekdayTitle: "Busiest days of the week",
    weekdayBasis: "Based on the last two months",
    weekdayOne: (a) => `Most of your visitors come on ${a}.`,
    weekdayTwo: (a, b) => `Most of your visitors come on ${a} and ${b}.`,
    weekdayEven: "Your visitors come fairly evenly through the week.",
    weekdayFew: "Not enough conversations yet to see a clear pattern.",
    nav: { overview: "Overview", journey: "Journey", activity: "Activity", content: "Content" },
    cardTitle: "Your assistant",
    cardText: "Try it yourself, or ask for a change.",
    collapse: "Collapse menu",
    expand: "Open menu",
    vsPrior: "vs prior period",
    insight: (used, change) => ({
      pre: "You've had ",
      strong: `${used} conversations`,
      post:
        change === null
          ? " this month so far."
          : change === 0
            ? " this month so far, the same as last month at this point."
            : ` this month so far, ${Math.abs(change)}% ${change > 0 ? "more" : "fewer"} than the same period last month.`,
    }),
    calendarHint: "Each square is a day. The stronger the colour, the more conversations. Tap a day to see its numbers.",
    less: "Less",
    more: "More",
    pickDay: "Tap a day in the calendar to see its numbers.",
    colConv: "Conversations",
    usedLabel: "Used",
    remainingLabel: "Remaining",
    tabs: "Navigation",
    empty: "No conversations in this period yet.",
    usedPct: (pct) => `${pct} of your plan used`,
    steps: {
      opened: "Opened the chat",
      started: "Wrote a message",
      engaged: "Joined the questions",
      qualified: "Answered the questions",
      form_shown: "Saw the form",
      form_submitted: "Sent their details",
      discount_offered: "Were offered the discount code",
      discount_unlocked: "Got the discount code",
    },
    stepHelp: {
      opened: "Visitors who tapped the chat button and opened the window.",
      started:
        "Visitors who sent at least one message. This is the step that counts toward your plan.",
      engaged: "Visitors who kept talking for about three messages, past the first question.",
      qualified: "Visitors who answered most of the assistant's questions (about six messages).",
      form_shown: "Visitors who were shown the form for leaving their details.",
      form_submitted: "Visitors who sent their details to you. These are your leads.",
      discount_offered: "Visitors who were offered the discount code in exchange for an email.",
      discount_unlocked: "Visitors who typed their email and got the discount code.",
    },
    whatsapp: (site) => `Hi Wael, I'd like to change something in my assistant (${site}): `,
  },
};
