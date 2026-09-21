import ChatWidget from "@/app/components/ChatWidget";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-12 dark:bg-black">
      <main className="flex w-full max-w-2xl flex-1 flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            وائل — مصمم مواقع فريمر
          </h1>
          <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            مواقع شركات، صفحات هبوط، ومتاجر إلكترونية. تصميم وتنفيذ على منصة
            فريمر، بخط عربي مضبوط واتجاه من اليمين لليسار.
          </p>
        </div>

        {/* max-h bounds the card so the MESSAGE LIST scrolls inside it. With
            only a min-height the card grew with the conversation (1246px on a
            800px screen) and the page scrolled instead, which meant a long
            chat opened at the first message. Same defect the embed had. */}
        <div className="flex min-h-[32rem] max-h-[70vh] flex-1 flex-col">
          <ChatWidget />
        </div>
      </main>
    </div>
  );
}
