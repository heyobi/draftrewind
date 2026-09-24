# Launch plan (money-focused, minimal)

Goal: reach ~35 iPhone sales/month (≈ $150 net) without paid ads. Everything below is free except the yearly fees
(Apple $99, Microsoft $19, domain ~$11).

## Pricing
| | Launch (first 6 weeks) | After |
|---|---|---|
| iPhone (App Store) | $2.99 | $4.99 |
| Windows (Microsoft Store) | $9.99 | $9.99 |
| Windows (GitHub) | free | free |
Set the Türkiye storefront by hand (≈ ₺149.99 iPhone, ₺249.99 Windows); do not let the store auto-convert.

## Timing
Thesis deadlines drive sales. Launch in the first week of **December** (Turkish fall-semester deadlines) and run the
second push in **May**. If the app is ready earlier, still soft-launch quietly and save the announcements for December.

## Week-by-week
1. **Site up** (draftrewind.com on Cloudflare Pages), email routing for support@, App Store listing submitted.
2. **Assets**: 30-second video (script below), 5 screenshots per language, one GIF of "close Word without saving → get it back".
3. **Launch day**: Product Hunt (EN), r/GradSchool + r/PhD + r/Thesis (EN, a plain story post, not an ad),
   Ekşi Sözlük + Twitter/X + Turkish "tez yazma" Facebook/Telegram groups (TR). Reply to every comment for 48 h.
4. **After**: one YouTube Short per week for 6 weeks reusing the same footage; ask every happy user for a review.

## 30-second video script
0–5 s  Word open, a long paragraph is typed. Cut: power goes out / the laptop closes. Caption: "No save."
5–12 s DraftRewind opens. Time Machine shows "Rescued: unsaved Word document" at the top.
12–20 s Click "What changed" — the paragraph is there, green. Click "Restore". Word reopens with it.
20–27 s Phone: the same history, tap a snapshot, share the PDF report to WhatsApp.
27–30 s "DraftRewind. Never lose a draft. Free for Windows." + URL.

## Posts (copy)
**EN (Reddit/PH):** I lost 3 pages of my thesis to a Word crash last year, so I built a small tool that keeps every
version of your thesis folder automatically — no Git, no setup, works offline, backs up to *your* GitHub/Drive. It also
rescues unsaved Word docs every few minutes. Windows app is free and open source; the iPhone app is $2.99 this month.
Feedback welcome: draftrewind.com

**TR:** Geçen yıl Word çökünce tezimin 3 sayfası gitti; o gün "bir daha asla" dedim ve bunu yazdım. DraftRewind tez
klasörünün her halini kendiliğinden saklıyor: Git yok, kurulum yok, internet gerekmez, yedek senin Drive/GitHub'ına.
Kaydetmediğin Word belgesini bile birkaç dakikada bir kurtarıyor. Windows'ta ücretsiz ve açık kaynak; iPhone
uygulaması bu ay 2,99 $. Deneyip söyleyin: draftrewind.com

## What to measure (monthly)
GitHub release download count · App Store units + proceeds · Microsoft Store units · support emails by topic.
Decide after 6 months: grow (Mac version, more phone features), keep, or leave as open source.
