# sonicdesk. — SEO Audit & On-Page Fixes

**Date:** 2026-07-02
**Scope:** Technical/on-page audit of the homepage (the site's only indexable page) + implemented fixes. Dedicated per-feature landing pages were explicitly out of scope for this round.

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

You explicitly scoped this round to on-page fixes only, so this wasn't built — but it's the highest-leverage next step. When you're ready:

1. **Dedicated feature pages** (`/features/version-control`, `/features/comments`, `/features/chord-detection`, `/features/band-chat`, `/features/rehearsal-mode`) — each targeting one phrase, interlinked from the homepage and each other.
2. **Comparison pages** — `/vs/bandlab`, `/vs/syncmuse` — these convert well and SyncMuse is already doing this against you indirectly (their "vs Dropbox vs Splice" post).
3. **A visible FAQ section + `FAQPage` JSON-LD** on the homepage — cheap to add without a new route, and Google requires FAQ markup to match visible content, so it'd need real visible copy, not just hidden schema.
4. **Get out of "private beta" messaging** where possible for SEO-facing pages, or add a waitlist-focused CTA — beta framing can suppress click-through on commercial-intent queries.
5. **Backlinks / content** — SyncMuse's free tools (`/tools/diff`, `/tools/loudness`) exist specifically to earn links and traffic; a simple free utility (e.g., a BPM/key detector) could do the same for sonicdesk.
6. **Search Console** — confirm `sonicdesk.studio` is verified and the sitemap is submitted once these changes ship.
