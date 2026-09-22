# Announcement emails

Two templates for Resend Broadcasts: `announcement-ar.html` (Arabic, RTL) and
`announcement-en.html` (English, LTR). They are NOT sent by the app — they are
pasted into Resend by hand, one broadcast per list.

## How to send one

1. Resend → Broadcasts → Create broadcast
2. Audience: **Templates (Arabic)** for the Arabic one, **Templates (English)**
   for the English one. NEVER send one language to both lists.
3. Switch the editor to code view — the `</>` button, top right.
4. Paste the whole file, then replace every `[[PLACEHOLDER]]`.
5. Send a test to yourself FIRST and click the unsubscribe link.

## The placeholders

    [[TEMPLATE_NAME]]   the template's name, e.g. نَبض or Navarro
    [[TEMPLATE_LINE]]   one sentence: who it is for
    [[TEMPLATE_URL]]    where to see it — the waelwebdesign.com page for
                        Arabic, the English demo for English
    [[IMAGE_URL]]       a screenshot of the template, ~1200px wide, hosted
                        somewhere public. DELETE the whole <img> row if none.

## Why they look the way they do

- **Tables, not divs.** Outlook renders email through Word, which does not do
  flexbox or grid. Tables are the only layout that works everywhere.
- **Inline styles.** Gmail strips `<style>` blocks in some views.
- **600px wide.** The width every email client is built around.
- **System fonts.** Web fonts do not load in most email clients; the Arabic
  stack falls back to whatever the reader's device uses for Arabic, which is
  always better than a wrong font.
- **A real unsubscribe LINK**, not a pasted URL. The first test broadcast went
  to Gmail spam with 20 words of content against 481 characters of raw
  unsubscribe URL — one sentence plus a huge opaque link is the shape of a
  phishing mail. The word "Unsubscribe" carrying the href fixes that.
- **A line saying why they are receiving this.** Nobody remembers signing up.
  It is also what keeps the soft opt-in honest — see CLAUDE.md.
