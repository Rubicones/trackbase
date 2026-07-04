# sonicdesk. — SEO Audit & On-Page Fixes

**Date:** 2026-07-02, updated 2026-07-05
**Scope:** Rounds 1–2: technical/on-page audit of the homepage. Round 3: page-per-intent architecture — new feature pages + competitor comparison pages.

## Round 3 — 2026-07-05

### ⚠️ Same-day rollback: /vs/* and /features/workflow REMOVED per user request — no competitor names allowed in metadata/content (legal). Stubs left (couldn't delete files); run: `rm -rf app/vs app/features/workflow components/landing/ComparisonPage.tsx components/landing/WorkflowFeaturePage.tsx`. Grep-verified: no competitor names remain in shipped source. Sections below mentioning /vs pages are historical.

### ✅ Round 2's critical domain bug is FIXED in production
Verified live: `https://sonicdesk.studio` now serves `canonical`, `og:url` and Twitter URLs pointing at **sonicdesk.studio** (not trackbase.studio). All round 1–2 on-page work confirmed live. Remaining from that fix: confirm `trackbase.studio` 301-redirects to sonicdesk.studio, and (re)submit the sitemap in Google Search Console.

### Context: slice pages already existed
Since round 2, `/features/{versions,structure,mobile}` and `/audience/{cover-band,indie-band,producer}` were built (SliceChrome pattern, `buildSlicePageMetadata`, in sitemap, footer-linked). Round 3 filled the gaps.

### Shipped this round

1. **Two new feature pages** (each targets one search intent, `force-static`, unique metadata):
   - `/features/comments` — "comments on bars", "timestamped track comments", "feedback tool for music". New `components/landing/CommentsFeaturePage.tsx` (waveform + range-selection + thread mock).
   - `/features/workflow` — "band chat app", "roadmap tool for bands", "checklist with assignments". New `components/landing/WorkflowFeaturePage.tsx` (chat-with-deep-links, roadmap + assigned checklist mocks).

2. **Three comparison pages** — factual & fair tone, all competitor claims verified against their live public sites on 2026-07-05 (SyncMuse free tier limits + Pro $12.99/mo; OmMuse tiers 100GB free/$9.99 Major/Enterprise + Dolby.io mastering; BandLab claims kept conservative — their marketing pages are client-rendered and serve empty HTML to crawlers, which is itself an SEO weakness of theirs):
   - `/vs/bandlab` — positions as different category (workspace vs free DAW + social).
   - `/vs/syncmuse` — closest competitor; overlap acknowledged (versions, timestamped comments, A/B), differentiation on branching/merging, bar-anchored comments, chords/structure/rehearsal/band layer.
   - `/vs/ommuse` — workspace vs storage + AI mastering.
   - Shared data-driven `components/landing/ComparisonPage.tsx` ("choose them if / choose us if" columns, feature table with notes, "credit where due" section, freshness disclaimer).

3. **Keyword-tuned existing slice metadata.** `/features/versions` title now "Version control for music — branch, merge & A/B compare" (was "Versions & A/B compare"); `/features/structure` now "Song structure editor & automatic chord detection"; `/features/mobile` now "Mobile mixer & rehearsal mode app for bands"; audience page titles extended with keyword-bearing suffixes.

4. **JSON-LD for all slice pages.** New `buildSlicePageJsonLd()` in `lib/seo.ts` (BreadcrumbList + WebPage) injected on all 8 feature/audience pages and 3 vs pages via existing `JsonLd` component.

5. **Discovery wiring.** `app/sitemap.ts` +5 URLs (11 slice pages total); homepage footer: DEEP DIVES column gained comments + workflow links, new COMPARE column (vs BandLab/SyncMuse/OmMuse), grid widened to 6 columns on lg. `SliceKind` extended with `"compare"` in SliceChrome. `SEO_KEYWORDS` +3 ("BandLab alternative", "SyncMuse alternative", "OmMuse alternative"). robots.ts already allowed `/vs/` (allow-all with disallow prefixes).

### Files changed (round 3)
- New: `app/features/comments/page.tsx`, `app/features/workflow/page.tsx`, `app/vs/{bandlab,syncmuse,ommuse}/page.tsx`, `components/landing/CommentsFeaturePage.tsx`, `components/landing/WorkflowFeaturePage.tsx`, `components/landing/ComparisonPage.tsx`
- Modified: `lib/seo.ts` (buildSlicePageJsonLd, keywords), `app/sitemap.ts`, `components/LandingPage.tsx` (footer), `components/landing/SliceChrome.tsx` (compare kind), all 6 existing slice `page.tsx` files (metadata + JSON-LD)

**Not verified by build** — sandbox had no disk space again. Run `npm run build` / `tsc --noEmit` before deploying. Changes are additive.

### Remaining backlog (priority order)
1. **Google Search Console** — verify domain, submit sitemap, and after the domain fix, watch for trackbase.studio ghosts. Highest remaining leverage, zero code.
2. **301 redirect trackbase.studio → sonicdesk.studio** (if you control the domain).
3. **Re-enable FAQ section + FAQPage JSON-LD** (built, commented out in `LandingPage.tsx` / `lib/seo.ts` — was hidden per your request; rich-result eligibility is free once visible).
4. **Beta messaging** — "PRIVATE BETA" framing on commercial-intent pages can suppress CTR; consider a waitlist CTA on slice pages.
5. **Free backlink-bait tool** (SyncMuse has /tools/diff + /tools/loudness) — e.g. a free BPM/key/chord detector at /tools/chord-detector.
6. **Blog/content** for long-tail ("how to organize band demos", "git for musicians").

## Round 2 — 2026-07-03

### 🔴 Critical: production canonical/OG points at the wrong domain

Fetching the live site (`https://sonicdesk.studio`) shows every canonical, Open Graph, and Twitter URL tag pointing at **`https://trackbase.studio`** instead — e.g. `<link rel="canonical" href="https://trackbase.studio">` and `og:url: https://trackbase.studio`. `trackbase.studio` returns an empty page (no app deployed there).

This is not a code bug — `lib/site-url.ts` and `.env.example` both correctly default to `https://sonicdesk.studio`, and there's no reference to `trackbase.studio` anywhere in the repo. The only explanation is that the **`NEXT_PUBLIC_SITE_URL` environment variable on the production host (Vercel) is still set to the pre-rebrand domain** (`trackbase` is this project's old/internal name — the folder, Supabase project, and R2 bucket are all still named `trackbase`).

**Effect:** Google indexes pages under their self-declared canonical URL. Right now every crawl of sonicdesk.studio is telling Google "the real version of this page lives at trackbase.studio" — a domain that serves nothing. This can suppress indexing of sonicdesk.studio entirely or split any authority between two URLs, one of which is dead.

**Action needed (cannot be fixed from code):**
1. In the Vercel project settings for the production deployment, set `NEXT_PUBLIC_SITE_URL=https://sonicdesk.studio` and redeploy.
2. If `trackbase.studio` is a domain you control, point it at a 301 redirect to `sonicdesk.studio` rather than leaving it empty — catches any stray links/bookmarks instead of losing them to a dead page.
3. After redeploying, re-fetch the homepage and confirm canonical/OG/Twitter URLs all read `sonicdesk.studio`, then (re)submit the domain and sitemap in Google Search Console.

This is the highest-priority item in this whole audit — every other fix here is close to worthless until it ships.

### Fixed this round
- **`/invite/[token]` was indexable.** It's a client-rendered legacy redirect (forwards to `/onboarding`) with no `metadata` export and no parent layout, so it silently inherited the homepage's indexable title/description. Added `app/invite/layout.tsx` with `noIndexMetadata('Invite')`, matching the pattern already used for `/auth`, `/dashboard`, `/band`, `/onboarding`, `/uikit`. (It was already disallowed in `robots.ts`, so this is defense-in-depth, not a reversal of an indexed page.)
- **Visible FAQ section + `FAQPage` JSON-LD** — the #3 "biggest remaining gap" from round 1. Built a real, visible FAQ section (`FAQ` in `components/LandingPage.tsx`, `SEO_FAQS` in `lib/seo.ts`) covering "what is version control for music," bar comments, chord detection, mobile mixer/rehearsal mode, a direct BandLab/SyncMuse/OmMuse comparison question, and pricing, mirrored into `FAQPage` structured data via `buildHomeJsonLd()`.
  **Update, same day:** hidden per your request — the `FAQ()` component, its `#faq` nav entry, and the `FAQPage` JSON-LD are all commented out (not deleted). `SEO_FAQS` content is still in `lib/seo.ts`, ready to go. To bring it back: uncomment the `FAQ()` block near the bottom of `LandingPage.tsx`, restore its render call + nav entry, restore the `SEO_FAQS` import, and uncomment the `faq` JSON-LD block in `buildHomeJsonLd()`.
- Verified `app/robots.ts` and `app/sitemap.ts` (added round 1) are present and correctly scoped — `robots.ts` disallows all authenticated/utility prefixes, `sitemap.ts` lists only the homepage (correct for a single-page site today).
- Verified OG image, favicon/icon, and web app manifest (`app/opengraph-image.tsx`, `app/icon.svg`, `app/manifest.ts`) all exist and reference the site correctly — no changes needed.

### Competitor check (verified live, 2026-07-03)
Confirms round 1's read: **SyncMuse** (syncmuse.co) is the direct threat — "async music collaboration," version snapshots, timestamped comments, and critically a page-per-intent architecture (`/features`, `/blog`, comparison posts like "SyncMuse vs. Dropbox vs. Splice"). **OmMuse** (ommuse.com) overlaps less — it's storage + AI mastering + royalty splits, not really a version-control play. **BandLab** wins purely on domain authority/brand search volume, not narrow feature-phrase targeting. sonicdesk's one-page architecture is still the structural ceiling on how many of these phrases it can rank for at once (see "Biggest remaining gap" below, unchanged from round 1 — still out of scope for this round per your instruction).

### Files changed this round
- `lib/seo.ts` — `SEO_FAQS`, `FAQPage` JSON-LD in `buildHomeJsonLd()`
- `components/LandingPage.tsx` — new `FAQ` section, `#faq` nav entry
- `app/invite/layout.tsx` — new, `noindex`

I couldn't run a production build to verify (sandbox has no free disk space) — run `npm run build` / `tsc --noEmit` locally before deploying. Changes are additive (new component, new exported constants/route, no removed exports), so risk is low.


## Competitor snapshot

| Competitor | Positioning | SEO approach |
|---|---|---|
| **SyncMuse** | "Async music collaboration" — version history, timestamped waveform comments | Closest direct competitor. Dedicated pages per audience (`/for/bands`, `/for/producers`, `/for/mix-engineers`) and per feature (`/session-history`), comparison pages (`/splice-studio-alternative`, blog post "vs Dropbox vs Splice"), free tools for backlinks (`/tools/diff`, `/tools/loudness`), full keyword-targeted meta tags, visible FAQ section. |
| **BandLab** | Free all-in-one DAW + social, "Bands" for group projects, auto-versioning/forking | Huge domain authority, ranks on brand + generic "make music online" terms rather than narrow feature phrases. |
| **Soundtrap (Spotify)** | Browser DAW with comments, live collaboration, chat, video calls | Same — wins on authority/brand, not narrow long-tail feature terms. |
| **OmMuse** | Storage + AI mastering + royalty splits, not really a version-control/comments play | Weak overlap with your target keywords. |
| **[Untitled]** | Mobile-first "vault" for unreleased music, has version history on replace | Different core use case (private storage/sharing vs. band production workflow). |

**Takeaway:** SyncMuse is the only competitor actually built to rank for phrases like "music version control" and "comments on bars" — and it does it with a page-per-keyword-cluster architecture. BandLab/Soundtrap win on domain authority instead. sonicdesk currently has **one indexable URL**, so it structurally cannot compete with SyncMuse's multi-page approach yet — see "Biggest remaining gap" below.

## What was already in good shape

- Next.js Metadata API wired through `lib/seo.ts` (title template, OG, Twitter cards, canonical, robots directives).
- `app/robots.ts` correctly disallows authenticated app routes (`/band/`, `/dashboard/`, `/onboarding/`, etc.) while allowing the marketing surface.
- `app/sitemap.ts`, `app/manifest.ts` present and correct for a single-page site.
- Homepage is `force-static` — full HTML ships to crawlers with no auth-cookie dependency.
- JSON-LD (`WebSite`, `Organization`, `SoftwareApplication`) already present via `buildHomeJsonLd()`.
- The visible copy already names most real features accurately ("Range comments with threads," "Chord-per-section · auto-detect," "Checklist with assignments") inside the `FeatureIndex` section — nothing was invented, only made more crawlable/keyword-aligned.

## Gaps found and fixed this round

1. **Duplicate H1s.** `app/page.tsx` had a screen-reader-only `<h1>sonicdesk.</h1>`, and `Hero` in `LandingPage.tsx` rendered a second, visible `<h1>sonicdesk.</h1>`. Two H1s with generic brand-only text is a duplicate-heading anti-pattern and wastes the page's single strongest on-page signal.
   - **Fix:** the visible Hero `<h1>` is now the only H1, with a hidden keyword-bearing suffix appended (*"— the band workspace with version control, comments on bars, chord detection, and rehearsal mode for music bands"*). `page.tsx`'s old sr-only block no longer duplicates the H1; it now provides a `<h2>Features</h2>` + `<ul>` feature summary instead (see #3).

2. **Meta title/description didn't cover your named feature keywords.** The description mentioned branching/merging/structure/chat/rehearsal but never said "comments," "chords," "checklist," or "band workspace" explicitly.
   - **Fix (`lib/seo.ts`):** `SEO_DEFAULT_DESCRIPTION` now reads: *"sonicdesk.studio is the band workspace for music version control. Branch and merge takes, drop comments on bars, auto-detect chords, chat with the band, and rehearse from your phone."* `SEO_KEYWORDS` expanded from 10 to 21 terms, adding exact-match phrases: `version control for music`, `band workspace`, `comments on bars`, `chord detection`, `automatic chord detection`, `band chat app`, `checklist with assignments`, `roadmap tool for bands`, `mobile mixer`, `rehearsal mode app`, `song structure editor`.
   - Minor note: the description is ~186 characters, a bit past Google's ~155–160 char comfortable display window. Left it slightly long to keep full keyword coverage for OG/Twitter cards and AI answer engines; trim it if you want a cleaner SERP snippet.

3. **Feature vocabulary wasn't in a crawlable, plain-language form.** The `FeatureIndex` section names features accurately but as short UI labels inside styled cards ("MIXER," "STRUCTURE & CHORDS"); nothing on the page spelled out full phrases like "version control for music" or "comments on bars" as sentences.
   - **Fix:** added `SEO_FEATURE_SUMMARY` to `lib/seo.ts` — 10 one-line, full-sentence feature descriptions using your exact target phrasing — rendered in a screen-reader-only `<ul>` on the homepage. This also improves accessibility for a highly animated/visual page, not just crawlability.

4. **Section headings (H2s) used stylized copy with no keyword match.** e.g. the versioning section's H2 is "BRANCH IT. MERGE IT. CHAT IT." and the feature-index section's H2 is "THE FULL STUDIO SURFACE." — on-brand, but zero overlap with how people search.
   - **Fix:** added an optional `seoNote` prop to `SectionHeader` that appends a hidden, keyword-bearing clause inside the actual `<h2>` tag (not a separate element) without touching the visible design:
     - Versioning → *"Version control for music: branch, merge, and compare takes without losing the original mix"*
     - Workflow → *"Band chat, project roadmap, and checklist with assignments in one band workspace"*
     - System (feature index) → *"Comments on bars, automatic chord detection, song structure tools, and a mobile mixer"*
     - Rehearsal → *"Rehearsal mode app with chord charts, loop sections, and range comments from your phone"*

5. **JSON-LD `featureList` was vague.** ("Git-like branching for music demos," "In-browser mixer and rehearsal view") — didn't match the phrases you want to rank for, which also matters for AI/LLM answer engines reading structured data.
   - **Fix:** rewritten to explicit phrases matching the on-page copy: version control, comments on bars, chord detection, mobile mixer/rehearsal mode, band chat, roadmap + checklist, band workspace.

6. **OG image alt text was just the brand name** (`sonicdesk.`).
   - **Fix:** now uses the full `SEO_DEFAULT_TITLE` ("sonicdesk. — Version control for music bands") for better image-search/accessibility context.

### Files changed
- `lib/seo.ts` — description, keywords, new `SEO_FEATURE_SUMMARY`, JSON-LD featureList
- `app/page.tsx` — replaced duplicate H1 with H2 feature summary block
- `app/opengraph-image.tsx` — alt text
- `components/LandingPage.tsx` — Hero H1 hidden suffix, `SectionHeader` `seoNote` prop + 4 call sites

I wasn't able to run a production build to verify (the sandbox has no free disk space right now) — worth running `npm run build` / `tsc --noEmit` locally before deploying. The changes are additive (new optional prop, new exported constants, no removed exports) so risk is low, but please double-check.

## Biggest remaining gap: one page can't rank for many different feature intents

Google generally ranks **one page per distinct search intent**. "Version control for music," "comments on bars," and "band chat app" are three different intents — SyncMuse already has separate pages/sections for a couple of these plus comparison pages against Splice/Dropbox/BandLab. Right now sonicdesk has exactly one indexable URL competing for all of them at once, which caps how many of these phrases it can realistically rank for simultaneously, no matter how well-optimized that one page is.

You've scoped both rounds to on-page/technical fixes, not new routes — but dedicated pages are the highest-leverage next step. Priority order:

0. **Fix the `NEXT_PUBLIC_SITE_URL` production env var (see Round 2 above) — do this first, before anything else below matters.**
1. **Dedicated feature pages** (`/features/version-control`, `/features/comments`, `/features/chord-detection`, `/features/band-chat`, `/features/rehearsal-mode`) — each targeting one phrase, interlinked from the homepage and each other.
2. **Comparison pages** — `/vs/bandlab`, `/vs/syncmuse` — these convert well and SyncMuse is already doing this against you indirectly (their "vs Dropbox vs Splice" post).
3. ~~A visible FAQ section + `FAQPage` JSON-LD on the homepage~~ — **done in Round 2** (2026-07-03).
4. **Get out of "private beta" messaging** where possible for SEO-facing pages, or add a waitlist-focused CTA — beta framing can suppress click-through on commercial-intent queries.
5. **Backlinks / content** — SyncMuse's free tools (`/tools/diff`, `/tools/loudness`) exist specifically to earn links and traffic; a simple free utility (e.g., a BPM/key detector) could do the same for sonicdesk.
6. **Search Console** — confirm `sonicdesk.studio` is verified and the sitemap is submitted once the domain fix ships.
