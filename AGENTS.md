> **Keep this file current.** AGENTS.md is the source of orientation for
> everyone (human or AI) who works on this project. Any time you add, remove,
> or meaningfully change a **feature**, an **API route**, a **database table or
> column**, an **environment variable**, or a **convention**, update the
> relevant section of this file in the same change. Treat outdated
> documentation as a bug. If you touch a feature and notice this file
> describes it incorrectly, fix the description as part of your work. A change
> that alters behavior but leaves AGENTS.md stale is incomplete.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# sonicdesk — AGENTS.md

## 1. What this project is

**sonicdesk** (production: https://sonicdesk.studio; package name `band-git`;
the repo folder is called `trackbase`, an old internal name) is version
control for music bands — "git for songs". A band uploads stems for a song,
branches off alternative takes, comments on specific bars of a waveform,
detects chords, chats, and rehearses from a phone.

The core mental model: **bands → projects (songs) → versions (Master +
branches) → tracks (audio/MIDI stems) → sections & comments**. A project has
one `main` version (displayed as "Master") plus branches. Branches are
"applied" (merged) into any target version with per-track / per-bar /
per-comment cherry-picking. Terminology is a display-layer mapping of git
concepts: branch→version, main→Master, merge→apply, conflict→overlapping
changes. **The DB keeps git terms** (`versions.type = 'main'`).

There is a full **subscription plan and entitlement system** (§4): plans,
limits, addons, upgrades, downgrades, grace periods and frozen bands, all
enforced server-side. **Stripe is wired in** — checkout, the customer portal,
add-ons as subscription items, and a signature-verified webhook — and it does
exactly one thing to entitlements: set `profiles.plan` and reconcile
`plan_addons` rows.

What gates it is **`BILLING_LIVE`** (`lib/billing/config.ts`), which requires
BOTH `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. While it is false — which
is the state of any deployment without those two env vars — the checkout and
add-on routes answer 503, the webhook 404s, "Subscribe" records demand in
`subscription_intents`, and plans are assigned only through the dev-only
switcher. So "no billing" is a *configuration*, not a missing feature: do not
read an unconfigured deployment as an excuse to build a second payment path.
Two of the billing migrations are applied by hand and are not optional — see
§4 *Billing (Stripe)*.

There is **no native mobile app** — no Capacitor/Android code exists in this
repo; mobile is the responsive web experience.

## 2. Tech stack

- **Next.js 16.2.7** (App Router, TypeScript 5, React 19.2.4) — heed the
  block above; read `node_modules/next/dist/docs/` before assuming APIs.
- **Vercel** hosting (serverless functions; env vars set manually there).
- **Tailwind CSS 4** via `@tailwindcss/postcss` + a large hand-rolled CSS
  variable design system (`app/globals.css`, `app/design-system.css`).
- **Supabase** (`@supabase/supabase-js` v2) — Postgres, email OTP auth
  (one-time codes; magic link retained as a legacy path), Realtime (chat +
  presence). No generated DB types; queries are untyped.
- **Cloudflare R2** via `@aws-sdk/client-s3` + `s3-request-presigner` —
  all audio/file storage (S3-compatible; `region: 'auto'`).
- **ffmpeg** — `fluent-ffmpeg` + `ffmpeg-static` + `ffprobe-static`
  binaries, run inside Vercel functions (see §7 tracing gotcha).
- **essentia.js 0.1.3** — WASM chord/key detection, both in a browser worker
  (`public/workers/chordsWorker.js`) and in Node (`lib/serverEssentia.ts`).
- **Tone.js 15** (`lib/mergedAudioBuffer.ts`) and **@tonejs/midi**
  (`lib/midi.ts` MIDI parsing); **soundfont-player** for MIDI playback.
- **archiver** — ZIP streaming for stem export.
- **web-push** — VAPID web push notifications.
- **googleapis** — Google Sheets mirror of feedback submissions.
- **GA4** via `@next/third-parties` + **Meta Pixel** (`lib/meta-pixel.ts`)
  + **Yandex Metrica** (`lib/yandex-metrica.ts`) + **@vercel/analytics**
  (all wired in `app/layout.tsx`; the first three only with cookie consent —
  see §4 *Cookie consent*).
- **motion**, **lucide/lucide-react**, **next-themes**.

## 3. Directory map

```
app/                        Pages + API routes (App Router)
  page.tsx                  Landing page (public)
  dashboard/                Bands list (authed home)
  band/[bandId]/            Band page: projects, members, activity, chat
  band/[bandId]/project/[projectId]/
                            The mixer. page.tsx (~3,600 lines, orchestrator) +
                            extracted modules: usePlayer.ts (playback engine),
                            TrackRow.tsx, Waveform.tsx, commentLayer.tsx,
                            MasterPlayerBar.tsx, Sidebar.tsx, modals.tsx,
                            skeletons.tsx, UploadRow.tsx, mixerChrome.tsx,
                            mixerUtils.ts, mixerTypes.ts, MergeModal.tsx
  auth/, onboarding/        Magic-link sign-in; 3-step onboarding
                            (campaign links like /maskeliade have NO page —
                             middleware handles them end to end, see §4)
  invite/[token]/           Legacy invite links (middleware 301s to onboarding)
  features/*, audience/*    Public SEO/marketing pages
  tools/chord-detector/     Public no-login chord detector tool
  uikit/                    Internal design-system reference page
  robots.ts, sitemap.ts, manifest.ts, opengraph-image.tsx   SEO surface
  globals.css, design-system.css   Theme / CSS variables (light+dark)
  api/                      All API route handlers (see §4 per feature)
components/                 Reusable UI (flat) + subfolders:
  design/                   App shell, buttons, modals, tooltips, wordmark
  ui/                       Primitives (button, input, avatar, spinner)
  chat/                     ChatDock + useBandChat (realtime)
  merge/                    Apply/cherry-pick UI (CherryPickDiff, targets)
  onboarding/               Welcome modals + ProjectTour + tour step defs
  paywall/                  PaywallLock, PlansModal
  plan/                     PlanUsage, DevPlanSwitcher, PlanConflictResolver,
                            GraceBanner, FrozenBandBanner
  push/                     Push permission UI + provider
  landing/, seo/, tools/, feedback/, analytics/, auth/
contexts/                   AuthContext, PaletteContext, PaywallContext
hooks/                      useBreakpoint, useVersionCache, etc.
lib/                        Shared logic (flat). Highlights:
  supabase.ts               SERVICE-ROLE server client (bypasses RLS!)
  supabase/server.ts        requireBandMember* auth guards — mandatory in routes
  supabase/client.ts        Browser anon client (Realtime)
  auth/                     Cookie session (sb-at/sb-rt), JWT verify/refresh
  r2.ts, r2TempKey.ts       R2 client, presign, key schemas
  ffmpeg.ts                 FLAC/WAV transcodes, edit rendering, PCM decode
  previewMix.ts / previewMixClient.ts   Preview-mix cache machine (server/client)
  trackMerge.ts             bar↔ms conversion, start_bar helpers
  chat.ts                   msToBar/beatsPerBar + chat types
  versionSort.ts            getVersionDisplayName ("Master" resolver)
  analytics.ts              trackEvent wrapper (GA4 + Meta Pixel + Yandex
                            Metrica mirror), setUserProperties (GA4 user
                            properties + Metrica userParams)
  campaigns.ts              Campaign slug registry (edge-safe)
  attribution.ts            Pending attribution in localStorage (client)
  pwa.ts                    isRunningAsInstalledPWA() — installed-app detection
  audioContext.ts / recordingAudioContext.ts   The two-AudioContext pattern
  midi.ts, midiRender.ts, midiSoundfont.ts     MIDI engine
  serverEssentia.ts, serverChordDetection.ts, chordDetection.ts, chords.ts
  activity.ts               logActivity (band activity feed)
  plans.ts                  ★ THE plan table — limits, features, prices. Isomorphic.
  entitlements.ts           getEffectiveEntitlements / getBandEntitlements, plan state
  planConflicts.ts          checkPlanConflicts (upgrade + downgrade + state)
  planChange.ts             changePlan (upgrade blocks, downgrade + grace)
  bandFreeze.ts             lazy freeze/unfreeze + the frozen-band write block
  freezeOrder.ts            pure keep/freeze split (shared preview + enforcement)
  planGuards.ts             server-side assertCanAddMember / storage / versions / feature
  planCopy.ts               all limit wording (isomorphic); apiErrorMessage
  planAnalytics.ts          plan_changed, limit_reached, band_frozen, … (client)
  bandLimit.ts              owned-band creation path (server); bandLimitClient.ts (UI copy)
  bandStorage.ts            per-band storage accounting (ceiling comes from the plan)
  googleSheets.ts, push/, rate-limit.ts, seo.ts, site-url.ts
public/
  sw.js                     Push service worker
  workers/chordsWorker.js   Browser chord-detection worker
  vendor/essentia/          WASM bundles copied by scripts/copy-essentia.mjs (postinstall)
supabase/migrations/        SQL files — run MANUALLY (see §5); not a full history
middleware.ts               Auth gate, canonical-host 301s, onboarding forcing
next.config.ts              ffmpeg tracing includes, security headers, rewrites
types/                      Ambient .d.ts (ffprobe-static, soundfont-player)
```

There is no `__tests__`/test runner configured. There is no Capacitor or
Android directory.

## 4. Feature map

### Auth & onboarding
**Email OTP** (Supabase Auth) from `app/auth/page.tsx`: two steps —
`signInWithOtp({ email })` requests a code, `verifyOtp({ email, token, type:
'email' })` exchanges the typed code for a session. **Supabase Auth owns the
code** (issue/hash/expiry/single-use live in the `auth` schema) — there is no
app table or SQL involved. Code length is `OTP_LENGTH` in `lib/auth/otp.ts`
(6, must match Supabase → Auth → Email → "Email OTP Length"); that file also
holds the resend cooldown and the error-copy mapping. Supabase enforces a
**minimum interval between auth emails per user** (Auth → Rate Limits,
default 60 s); the resend button counts down from
`OTP_RESEND_COOLDOWN_SECONDS` and self-corrects from the 429 message via
`parseOtpRetryAfterSeconds()` instead of firing a request that would fail.
The segmented code input is `components/auth/OtpInput.tsx` — **one real
`<input>` overlaid on presentational boxes**, not N inputs, which is what
gives it cross-box selection, bulk backspace, paste-from-any-box,
`autocomplete="one-time-code"` autofill and a single screen-reader field (the
component header explains the trade-off; don't "fix" it into N inputs).
Digits reveal with `animate-otp-digit-in` / `-out`, the card `animate-slide-in`
motion scaled to a glyph.

Post-sign-in behaviour is shared, not duplicated:
**`lib/auth/post-sign-in.ts` `resolvePostSignInPath()`** mirrors the session
into cookies and resolves the destination, and is called by both the OTP
success path and the retained magic-link callback. `app/auth/callback/page.tsx`
is **legacy but live** — it still handles links already in inboxes and the link
variant in the Supabase email template, and `emailRedirectTo` is still passed
for that reason. It posts tokens to `POST /api/auth/session`, which verifies
them and sets **HttpOnly cookies `sb-at` / `sb-rt`**
(`lib/auth/session.ts`, `cookie-options.ts`).
`middleware.ts` verifies/refreshes on every request and forces the onboarding
flow until `user_metadata.username` and `user_metadata.onboarding_complete`
are set. Onboarding (`app/onboarding/page.tsx`) is 3 steps: theme → username
(`/api/profile/username`, `/api/auth/username-check`) → create or join a band
(`/api/profile/complete-onboarding`). Feature-tour completion flags live in
`profiles.onboarding` (jsonb) via `/api/profile/onboarding`; tours are in
`components/onboarding/ProjectTour.tsx` + `featureTourSteps.ts` /
`mobileProjectTourSteps.ts`. Closing the dashboard welcome modal for the
first time also fires a one-shot spotlight on the footer "Feedback & Report"
button (`components/onboarding/FeedbackHint.tsx`, flag `feedback_hint_seen`,
target `data-tour="feedback-launcher"`) — same lime-ring visual language as
`ProjectTour` but single-target and non-blocking, so the button underneath
stays clickable.

**Welcome-modal ordering (easy to break):** onboarding's "create a space" path
lands the user on `/band/[id]`, *not* `/dashboard`. So `BandWelcomeModal`
(`band_seen`) is the first modal most new users ever see, and the feedback hint
is chained to **both** it and `DashboardWelcomeModal` (`dashboard_seen`) —
whichever fires first wins, since `feedback_hint_seen` is one-shot. Do **not**
pre-set `dashboard_seen` from the onboarding flow: it was set there once to
avoid a "stale" welcome and the result was that users who created a space never
saw the Spaces welcome or the feedback hint at all.

### Campaign attribution
Dedicated landing links tag where a user came from, permanently, so a cohort
recruited from one place can be compared against organic signups.
`lib/campaigns.ts` is the **registry** (slug → `{ source, cohort }`) and the
only file that knows which campaigns exist; `/maskeliade` (warm test, July
2026) is the only one today.

**A campaign link has no page component.** `middleware.ts` intercepts `/{slug}`
above the auth gate, sets the `sd-campaign` cookie (`CAMPAIGN_COOKIE`, 30 days,
first-touch — never overwritten) and 307-redirects to `/`. No React renders, so
there is no loading screen and no client dependency;
`PATCH /api/profile/username` then resolves the cookie **server-side** against
the registry and clears it once the profile is settled (so the next person to
sign up in that browser can't inherit the tag). 307 not 301 on purpose: a
permanent redirect would be browser-cached and later clicks would skip
middleware, and with it the cookie.

**Adding a campaign is one registry entry.** No file to copy, no route to
create.

This replaced a localStorage-only mechanism (a `/{slug}` page whose client
effect wrote the values). That design put attribution behind "React mounted,
the effect ran, storage was writable", and when any of it failed the signup was
simply unattributed with nothing in the data to say why. `lib/attribution.ts`
survives as the *client's* view of the campaign — cookie first, legacy
localStorage second — and is not on the write path at all. Note sessionStorage
is deliberately not used anywhere here: it dies with the tab, so a visitor who
clicks the link and signs up later would lose the campaign.
**Campaign paths must be intercepted above the auth gate in `middleware.ts`**,
or it redirects the signed-out visitor — the exact person a campaign link
exists for — before the cookie is ever set.
Adding a campaign = a registry entry + a copy of the stub; nothing else.

Attribution is **first-touch and first-account**: middleware never overwrites
an earlier campaign cookie, and the values are written to the profile only by
`PATCH /api/profile/username`, guarded by **`isFirstUsername()`** — "does this
account have no `user_metadata.username` yet?". That route is the only writer
of that metadata field and `middleware.ts` forces onboarding until it exists,
so its absence means "has never completed the username step" = the account is
being established right now. An existing user always has it and can never be
re-tagged. **Never** widen this to "acquisition_source is null": that would
re-tag existing organic users the first time they open a campaign link.

The guard used to be `.eq('username', placeholderUsername(userId))` *inside*
the UPDATE, which read better but made correctness depend on reproducing the
`handle_new_user` trigger's output in TypeScript. **It never matched**: the
live trigger is just `insert into public.profiles (id) values (new.id)`, so a
new profile has `username` NULL and there is no placeholder — see §5. Every
campaign signup came out `cold`/NULL, with no error anywhere. The write is now
an `upsert` for the same class of reason: a missing profile row must not be
another silent zero-row write. Both the inputs and the outcome are logged
(`[profile/username] attribution`, Vercel Runtime Logs), because this write
happens once per account and cannot be verified afterwards. The route returns `attributed`;
only then does the client fire `trackEvent('signup_attributed', { source,
cohort })`, clear the two keys, and set the GA4 `cohort` user property
(set for cold users too, so the segment has both sides).

### Bands
Routes: `/api/bands` (create), `/api/bands/[id]` (get/update),
`.../members`, `.../members/[userId]`, `.../members/me` (roles: `owner` /
member, plus free-form `role_label`/`role_color`), `.../activity`,
`.../projects`. Joining: human-readable invite codes on `bands.invite_code`
(generated in `lib/inviteCode.ts`, ADJECTIVE-NOUN pools) →
`/api/bands/join` + `/api/bands/join/check` create `band_join_requests`
which the owner approves via `/api/bands/[id]/join-requests[/requestId]`;
`/api/me/join-requests` shows the requester's own. A join request pushes a
notification to the owner. Legacy token invite links (`band_invites` table,
`/api/invites/[token]/*`, `app/invite/[token]`) still exist; middleware
301-redirects `/invite/*` to `/onboarding?step=3`. Activity feed:
`lib/activity.ts` `logActivity()` → `band_activity`, read via
`/api/bands/[id]/activity`.

**Band ownership limit.** A user may own at most their *effective* owned-bands
limit, resolved by `getEffectiveEntitlements()` from their plan + `extra_band`
addons, **unless `profiles.band_limit` is non-null, in which case that value
replaces the whole computation** (see Subscription plans below). Only bands the
user *owns* count; `band_members.role = 'owner'` is the definition of
ownership, so bands they joined are free and unlimited. `lib/bandLimit.ts` is
the single server-side implementation: `createBandForUser()` (limit check +
both inserts, atomic) and `getBandLimitStatus()`. **Both band-creation paths go
through it** — `POST /api/bands` and `POST /api/projects` when no `band_id` is
supplied (that one spins up an implicit band). Refusal is
`403 { error: 'limit_reached', limit_type: 'bands', limit, current }` (the
client parser also still accepts the legacy `band_limit_reached` shape).
Defence in depth is in the DB: `create_band_with_owner()` (atomic RPC) and the
`trg_enforce_band_owner_limit` BEFORE INSERT/UPDATE trigger **on
`band_members`** — ownership is a membership row, not a column on `bands`, so
that is the only table where the constraint can fire at the right moment. Both
now compute the limit via `effective_band_limit()` (plan base + addons, or the
override) and both take `SELECT … FOR UPDATE` on the profiles row, which is
what makes two simultaneous creates at limit − 1 produce exactly one band.
Both raise SQLSTATE `BL001` / message `band_limit_reached`, which the route
translates instead of leaking a 500. The UI reads `bandLimit` from
`/api/dashboard` (dashboard) or `GET /api/me/band-limit` (onboarding) and locks
the create action with copy from `lib/bandLimitClient.ts`; it is **UX only and
never the gate**, and the client never sends the limit or the count to the
server. Hitting the cap fires `trackEvent('band_limit_reached', { limit })`.

### Projects & the mixer
`app/band/[bandId]/project/[projectId]/page.tsx` is the mixer orchestrator
(~3,600 lines; the playback engine lives in `usePlayer.ts` and the row/
transport/sidebar UI in sibling modules — see the directory map): track
list, client-decoded waveforms (`lib/waveform-decode.ts`,
`waveformCache.ts` — amplitude bars are computed from the fetched FLAC, not
stored in the DB), playback through the shared 48 kHz AudioContext
(`lib/audioContext.ts` — single master GainNode bus), per-track gain,
metronome (`lib/useMetronome.ts`), comments, structure, recording, MIDI.
Project meta (name/bpm/key/time_signature) via `/api/projects/[id]`;
project stage via `PATCH /api/projects/[id]/stage`
(`idea|demo|arrangement|recording|mixing|mastering|released` →
`projects.stage`, `stage_since`). Track streaming/download:
`/api/tracks/[id]/stream`, `/api/tracks/[id]/download`; track rename/icon:
`PATCH /api/tracks/[id]/rename`, `PATCH /api/tracks/[id]/icon`.

### Versioning
Tables: `versions` (`type 'main'|'branch'`, `parent_id`, `merged_at`,
`merged_into_id`, `tag`). Create branch: `POST /api/projects/[id]/versions`.
**The name "Master" is reserved** — creation rejects it
(`app/api/projects/[id]/versions/route.ts`). Display names:
`lib/versionSort.ts` `getVersionDisplayName()` shows legacy
`type='main' && name='main'` rows as "Master" — **display only, the DB row
never changes**. Version tags (`versions.tag`, ≤20 chars) via
`PATCH /api/versions/[id]`.

Apply (merge): `POST /api/projects/[id]/merge` with preview at
`.../merge/preview`. It is a **two-way diff of branch vs. target** (any
target, default main) — no ancestor walk. Tracks match by name (version wins
on differences unless in `skippedTracks`; target-only tracks kept unless in
`removedTracks`); structure diffs per bar (`lib/sectionMerge.ts`
`buildBarMap`/`diffBarMaps`, with `skippedSections` bar coverage); comments
diff by content fingerprint with per-comment cherry-picks. The same
primitives drive preview and apply, so what's reviewed is what's applied.
`lib/mergeBase.ts` (three-way LCA) exists but is **not referenced by any
route** — legacy. Cherry-pick UI: `components/merge/` + `MergeModal.tsx`.

### Track offset (start_bar)
`tracks.start_bar` (0 = bar 1; negative = pre-roll; `midi_start_bar` is the
legacy column — always read via `trackStartBar()` in `lib/trackMerge.ts`).
`startBarToMs()` converts using project bpm + time signature. Respected in:
mixer playback scheduling, preview mix (`adelay` in `lib/previewMix.ts`),
WAV export (silence pad/trim), and merge diffs. Server floor: −512
(`sanitizeTrackStartBarForServer`).

### Track edit mode
Client editing (split/duplicate/copy/paste on a quarter-bar grid) in
`components/TrackEditArea.tsx` + `lib/trackEdit.ts`. On apply,
`POST /api/tracks/[id]/edit` sends segments/clips (bar numbers validated as
¼-bar multiples, ≤256 segments × ≤512 clips), the server re-renders via
`renderEditedFlac()` (`lib/ffmpeg.ts`), hashes, uploads a new FLAC to R2, and
updates the row. Editing Master prompts `MasterEditConfirmModal` (suppression
stored 24 h in localStorage — `lib/masterEditGuard.ts`). Paywall-gated as
`track_edit`.

### A/B Compare
`components/CompareMode.tsx` — side-by-side playback of two versions with
per-version section loop selection (`lib/sectionPlayback.ts` builds bar→
section ranges). Paywall-gated as `ab_compare`.

### Song structure & chords
`sections` table (type/custom_name/start_bar/end_bar/chords/`note` ≤40-char
performance cue/color/position). CRUD: `/api/versions/[id]/sections`
(+`/reorder`); activity logging via `/api/versions/[id]/structure/submit`
(there is no plain `/structure` route); read-only main-version summary at
`/api/projects/[id]/structure-preview`. Editor:
`components/StructureEditor.tsx` (+ `ChordInput`, `ChordDurationPicker`,
`StructurePreviewPanel`). Chord detection runs **client-side** in
`public/workers/chordsWorker.js` (Essentia WASM from
`public/vendor/essentia/`, copied on postinstall) via `lib/chordDetection.ts`;
paywall-gated as `chord_detect`. Key/chord math helpers: `lib/chords.ts`.

### MIDI piano roll
Upload `.mid` → parsed by `lib/midi.ts` (@tonejs/midi) into
`tracks.midi_data` (jsonb; `file_type='midi'`). Editor:
`components/PianoRollEditor.tsx` (full) + `MiniPianoRoll.tsx` (inline);
save via `/api/tracks/[id]/midi`, re-import via `/api/tracks/[id]/midi-upload`.
Playback: instruments from **soundfont-player, fetched from the network at
runtime** and cached per-AudioContext (`lib/midiSoundfont.ts` — instruments
must never cross AudioContext instances); transport playback uses an
**offline render to AudioBuffer** (`lib/midiRender.ts`) to avoid per-note
scheduling artifacts. Caveat: **MIDI tracks are skipped by the preview mix**
(V1 limitation, see `lib/previewMix.ts` header).

### Recording
**Web-only** (getUserMedia — there is no native Android plugin in this repo,
despite what older docs may claim). `components/RecordingTrackRow.tsx`
(~1,600 lines: monitoring, count-in, post-record nudge alignment),
`lib/micCapture.ts`, and a **separate recording AudioContext at hardware
sample rate** (`lib/recordingAudioContext.ts` — deliberately NOT pinned to a
rate; pinning 22050 previously caused glitchy monitoring). Metronome:
`lib/useMetronome.ts` / `lib/metronomeAudio.ts` through the shared playback
context.

### Upload pipeline
Preferred: `POST /api/versions/[id]/tracks/presign` (≤200 MB; wav/mp3/midi)
→ browser PUTs directly to R2 at `temp/{uuid}-{filename}` (R2 bucket needs
CORS, see comment in `lib/r2.ts`) → `POST /api/versions/[id]/tracks/process`
validates the temp key against `lib/r2TempKey.ts` **exactly**, transcodes to
FLAC (`audioToFlacFromFile`), SHA-hashes, **dedups by `file_hash`** (reuses
the existing R2 object at `projects/{projectId}/{hash}.flac` — `r2Key()`),
inserts the `tracks` row, deletes the temp object, and calls
`markPreviewMixStale`. Legacy: `POST /api/versions/[id]/tracks/upload`
(multipart through the server). Both enforce the **1 GB per-band storage
quota** (`lib/bandStorage.ts`).

### Export WAV
`GET /api/versions/[id]/export` (`maxDuration = 300`) — audio stems converted
FLAC→WAV, each padded/trimmed by its `start_bar` offset converted to ms,
returned as a ZIP built by archiver.

**There is no size limit, and that is load-bearing on the design.** The route
is a streaming producer: exactly one stem exists on disk at a time. Each is
pulled from R2 to a file (`streamR2ObjectToFile`), transcoded file→file
(`flacFileToWavFile`), appended to the archive, and deleted before the next one
starts. Peak `/tmp` is one stem no matter how large the version is, and no
audio ever touches the heap. Every rule below is a production bug this replaced
— the function has a 512 MB `/tmp` and a fixed heap, and earlier revisions blew
through both:

- **Never `Promise.all` the stems.** That held every FLAC *and* its decoded
  24-bit WAV (~17 MB per stereo minute) in memory at once and exhausted the
  heap.
- **Never buffer.** `flacToWav` / `flacToWavFile` (buffer-taking) are for
  single-track downloads only; bulk paths use `flacFileToWavFile`.
- **Never write the ZIP to `/tmp` first.** That made peak disk the stems *plus*
  a zipped copy of them and failed with a bare `ENOSPC: no space left on
  device`. The archive goes to the response via `Readable.toWeb()`.
- **`appendAndWait` is not an ornament.** Awaiting archiver's `entry` event is
  both the signal that the staged file is safe to delete *and* the backpressure
  — the archive drains only as fast as the client downloads, so a slow
  connection throttles transcoding instead of letting stems pile up.
- **Consequence: no `Content-Length`** (chunked response, no browser progress
  bar), and a failure mid-stream can only present as a truncated archive since
  the headers are long gone. Both are accepted trades; don't "fix" either by
  buffering.
- **`/tmp` is per-instance, not per-invocation** — shared with any other request
  on the same warm Vercel instance and surviving between them, so cleanup runs
  on the producer's own `finally` and on `req.signal` abort, never in the
  handler's `finally` (which fires while the archive is still reading). The
  `streaming` flag guards exactly that.
- **MIDI tracks are copied out as raw `.mid`** — ffmpeg cannot decode MIDI
  without a soundfont, so routing a `file_type='midi'` row through the WAV
  transcode throws and fails the whole export.
- **Rows with a null `storage_path` are skipped**, not fatal.

The remaining ceiling is wall-clock, not size: the function stays alive for as
long as the client is still downloading, so a very large export on a slow
connection can hit `maxDuration`.


Errors respond `{ error, stage, detail }` and log `[versions/export] failed at
stage=…` — keep the `stage` markers, they are the only way to localise a
failure in Vercel's runtime logs.

### Preview mix
`lib/previewMix.ts` — cached 128 kbps MP3 of Master at R2
`previews/{projectId}/mix.mp3`. State machine on `projects`:
`preview_mix_status ∈ 'none' | 'fresh' | 'stale' | 'computing'`, plus
`main_version_modified_at` (bumped by every audio-affecting mutation via
`markPreviewMixStale()` — call it from any new mutation that changes Master's
audio). `GET /api/projects/[id]/preview-mix` serves it
stale-while-revalidate: first-ever generation ('none') computes inline;
'stale' serves old audio and recomputes in the background via `after()`
(60 s debounce `PREVIEW_DEBOUNCE_SECONDS`, 5 min stuck-lock
`PREVIEW_STUCK_LOCK_MS`); `.../preview-mix/recompute` forces it. A 'fresh'
mix generated before `PREVIEW_MIX_FORMAT_UPDATED_AT` is refreshed in the
background like 'stale'. Loudness: the rendered mix is boosted ×1.5
(`PREVIEW_MIX_LOUDNESS_BOOST`) unless any stem was originally an MP3
(checked via `tracks.original_filename` — storage is always FLAC), since
WAV-sourced previews otherwise play much quieter than the full stem mix.
Client cache/preload: `lib/previewMixClient.ts`. Used by the band page,
Rehearsal View, and both mixers: on the Master version, `usePlayer` plays
the preview mix while stems fetch (mobile shows a transport status badge;
desktop `MasterPlayerBar` shows a "tracks loading · preview mix" badge over
the bottom progress bar) and switches to the full mix once all buffers are
decoded and playback pauses/ends.

### Chat
`components/chat/ChatDock.tsx` + `useBandChat.ts`; API
`/api/bands/[id]/messages`; table `band_messages` — **`channel_id` null =
band-wide channel, otherwise it's a project id**. Delivery is Supabase
Realtime: the table is in the `supabase_realtime` publication and RLS
governs who receives rows; the browser must push its JWT onto the socket via
`syncSupabaseRealtimeAuth()` (`lib/supabase/realtime-auth.ts`). Messages can
carry context chips (`context_version_id/track_id/timecode_*`), rendered
with bar numbers via `msToBar()` (`lib/chat.ts`). Posting a track comment
(`POST /api/tracks/[id]/comments`) auto-inserts a `type='track_comment'`
chat message. Presence: realtime channel `band-presence-{bandId}` while the
panel is open. `@mention`s trigger push notifications.

### Push notifications
VAPID web-push. Client: `components/push/*`, `lib/push/client.ts`, service
worker `public/sw.js`; subscriptions stored via `POST /api/push/subscribe`
in `push_subscriptions` (410 responses delete the row). Server:
`lib/push/server.ts` `sendPushNotification()`. Exactly **two triggers**
today: join-request → band owner (`app/api/bands/join/route.ts`) and chat
@mention → mentioned members (`app/api/bands/[id]/messages/route.ts`).

### Comments
`track_comments` + `comment_replies`. **Timecodes are track-relative ms**
(from the start of the track's audio, not the project timeline — see
migration `20260625_comment_timecodes_track_relative.sql` and
`lib/commentTimecodes.ts`). Routes: `/api/tracks/[id]/comments`,
`/api/comments/[id]`, `/api/comments/[id]/replies`, `/api/replies/[id]`.

### Resources, roadmap, checklist
Resources (`project_resources`: `type 'file'|'link'|'lyrics'|'notes'`,
optional context chips pointing at a version/track):
`/api/projects/[id]/resources`
(POST doubles as presign; legacy `/resources/presign` is rewritten to it in
`next.config.ts`), `/process` (finalize temp upload), `/lyrics`,
`/[resourceId]`, `/[resourceId]/download`. UI: `components/Resources*.tsx`,
`ProjectSidebarResources.tsx`; project notes at
`/api/projects/[id]/notes`. Roadmap: `project_roadmap_steps` +
`projects.roadmap_step_index` via `/api/projects/[id]/roadmap`
(`components/SongRoadmap.tsx`, `RoadmapPreview.tsx`). Checklist:
`project_checklist_items` via `/api/projects/[id]/checklist[/itemId]`
(`components/SongChecklist.tsx`). Band storage usage:
`/api/projects/[id]/storage`.

### Rehearsal View (mobile)
`components/MobileExperience.tsx` wraps the project page on small screens:
`ReadingMode.tsx` (the rehearsal view — chord timeline, sections, lyrics,
preview-mix player) and `MobileMixerPortrait.tsx` (mobile mixer), plus the
mobile tour. Events: `rehearsal_mode_entered`, `mixer_opened_from_rehearsal`.

### Analytics (GA4 + Meta Pixel + Yandex Metrica)
Always use `trackEvent(name, params)` from `lib/analytics.ts` — it sends to
GA4 (`window.gtag`) and mirrors to **both** the Meta Pixel and Yandex Metrica,
adding `app_version`. ~80 snake_case events exist; follow the taxonomy
(`noun_verb`/`noun_verb_past`): e.g. `project_opened`, `merge_completed`,
`comment_created`, `paywall_modal_opened`, `recording_saved`,
`tour_skipped`. `setUserProperties()` sets GA4 user properties and mirrors to
Metrica `userParams`. **A new event needs no per-destination work** — adding a
`trackEvent` call reaches all three.

Each destination has one mirror module, and that module is the only place that
knows about it: `mirrorToMetaPixel` (`lib/meta-pixel.ts`) and
`mirrorToYandexMetrica` (`lib/yandex-metrica.ts`). Both skip `page_view`,
because each vendor's own script already counts the initial load and its
route-change tracker handles SPA navigations — mirroring would double-count.
Page views: `components/analytics/PageViewTracker.tsx` (GA4),
`MetaPixel.tsx` (`fbq PageView`), `YandexMetrica.tsx` (`ym hit`, passing the
previous URL as `referer` since Metrica can't infer it on an SPA navigation).
GA/Pixel/Metrica are mounted by `components/analytics/ConsentedTrackers.tsx`
(only with consent — next section); Vercel Analytics (cookieless) directly in
`app/layout.tsx`. Pixel + Metrica also render nothing when their env var is
absent.

### Legal pages
`/terms`, `/privacy`, `/refund` — static, public (`PUBLIC_PREFIXES` in
`middleware.ts`), in `app/sitemap.ts`, linked from the landing and slice-page
footers next to *Cookie settings*. Route files are thin wrappers around
`components/legal/{Terms,Privacy,Refund}Document.tsx`, whose copy is verbatim
from `sonicdesk_designs/src/routes/{terms,privacy,refund}.tsx` (the design
source of truth — change copy there first, then mirror it). Shared shell:
`components/legal/LegalDocument.tsx` (+ `legal.css`); bump
`LEGAL_LAST_UPDATED` whenever a document's copy changes.

**Terms acceptance.** The `/auth` email step shows, under Continue: "By
continuing, you agree to our Terms of Service and acknowledge our Privacy
Policy." — plain text, no checkbox. **"acknowledge", never "agree to", for the
Privacy Policy** (GDPR: information, not a contract). Recorded server-side
only, by `handle_new_user`, on the profile row it creates:
`terms_accepted_at = now()`, `terms_version = public.current_terms_version()`
(`supabase/migrations/20260923_terms_acceptance.sql`). That SQL function is the
single source of the version (ISO date); **when the Terms change, re-run it
with the new date and bump `LEGAL_LAST_UPDATED.terms` to match.** Existing
users are never re-stamped. The browser cannot write either column (UPDATE is
column-granted without them; INSERT on `profiles` is revoked).

### Cookie consent (GDPR)
GA4, the Meta Pixel and Yandex Metrica **must not load, set cookies or send a
request before the visitor clicks Accept.** Gated at render time, never
"loaded then suppressed":
- **Storage:** cookie `sd_consent` = `accepted.<ms>` | `rejected.<ms>`,
  Max-Age 12 months, and a stored timestamp older than 12 months also counts
  as no choice (`lib/consent.ts` — `parseConsent`, `writeConsentCookie`).
  A cookie, not localStorage, so `app/layout.tsx` reads it server-side.
- **Rendering:** `ConsentProvider` (seeded with the server-read value,
  re-read from `document.cookie` on mount) → `ConsentedTrackers` returns
  null unless `accepted`. ⚠ The landing and `/features/*`, `/audience/*`,
  `/tools/*` pages are `force-static`, where `cookies()` is empty: their HTML
  is tracker-free for everyone and trackers mount after hydration. Don't
  "fix" that by removing `force-static`.
- **Sending:** `trackEvent`, `setUserProperties`, and every Meta/Metrica
  helper check `hasTrackingConsent()` on each call, so withdrawing consent
  stops events at once. On Reject, already-loaded scripts are also told to
  stop via vendor switches (`ga-disable-<id>`, `fbq('consent','revoke')`)
  but are **not** unloaded; they are simply not rendered on the next load.
- **UI:** `components/consent/CookieBanner.tsx` — fixed bottom bar, not a
  modal. Reject and Accept share one class string: **equal visual weight is a
  legal requirement, never restyle one of them alone.** `CookieSettingsLink`
  (landing + SliceChrome footers, AppShell/AuthShell status footers) reopens it.
- **Privacy Policy:** `PRIVACY_POLICY_HREF` in `lib/consent.ts` is a
  placeholder (`/privacy`, no page yet; already public in middleware).
- **Any new non-essential tracker** goes inside `ConsentedTrackers` and its
  helpers check `hasTrackingConsent()`. Essential cookies (auth session, theme)
  are not gated. The Metrica `<noscript>` pixel was
  removed on purpose — a no-JS visitor can never consent.

**Metrica goals must also be created in the counter UI** (Settings → Goals →
"JavaScript event", Identifier = the exact event name) before they appear in
reports; `reachGoal` calls for undeclared goals are silently dropped, so no
allow-list is kept in code. Metrica runs with `clickmap`, `trackLinks` and
`accurateTrackBounce`; **Webvisor session recording is deliberately off** —
enabling it records user interaction in detail and needs a privacy-policy
change first.

### Feedback modal
`components/feedback/` → `POST /api/feedback` (type
`positive|negative|bug`, 10–2000 chars). Inserts into Supabase `feedback`
**under the user's JWT** (RLS applies) and best-effort mirrors a row to a
Google Sheet (`lib/googleSheets.ts`; columns Timestamp|Email|Type|Message|
Page URL; tab from `GOOGLE_SHEETS_TAB`, default `Sheet1`). Sheet failure
never fails the request.

### Subscription plans & entitlements

**No Stripe, no checkout, no webhooks, no invoices, no proration.** What
exists is the entitlement engine Stripe will one day drive. When it arrives it
will do exactly one thing: set `profiles.plan` and insert `plan_addons` rows.
Nothing in this system may read a Stripe id, a subscription status or a price
— design to that seam.

**`lib/plans.ts` is THE source of truth** for every limit, feature and price.
Four plans (`free` | `solo` | `band` | `band_plus`). **Never write a plan
number anywhere else** — a literal `3` or `500` in a route handler is a bug,
and with no test suite it is a silent one. `null` means unlimited (not
`Infinity`, so the wire format and the in-memory format are identical); use
`withinLimit()` / `remaining()` / `addToLimit()` rather than comparing by
hand. Gated features: `ab_compare`, `track_edit`, `chord_detect`,
`cherry_pick` — locked on free, included on every paid plan.

⚠ **The four are not enforced the same way, and the difference is structural.**
`track_edit` and `cherry_pick` have server endpoints that call
`assertBandFeature()`, so hiding the button is not the gate. `ab_compare` and
`chord_detect` have **no server endpoint to gate** — A/B Compare is client-side
playback of versions the user may already read, and chord detection runs
entirely in a browser worker (`public/workers/chordsWorker.js`). For those two
the client check IS the enforcement, and anybody who can set a JavaScript
variable has them. Do not assume otherwise, and do not "add the missing server
check" without first moving the work to a server. Making them paid in any
stronger sense is a product decision, not a patch.

**Two rules that are easy to violate by accident:**
- **Owned bands only.** There is NO limit on how many bands a user may be a
  MEMBER of, on any plan, free included. Nothing counts non-owner
  memberships and nothing should. (The plans modal used to advertise a "3
  bands as a member" cap that never existed; the limit lines are now
  generated from `lib/plans.ts` so that cannot recur.)
- **Storage is strictly per band, never pooled.** A Band+ owner with five
  bands has 50 GB in *each*. There is no account-wide storage total anywhere
  in this codebase; do not add one.

**Resolution — `lib/entitlements.ts`.** `getEffectiveEntitlements(userId)` is
the only place limits are computed; everything else calls it (or the
band-scoped `getBandEntitlements(bandId)`). Order: plan base → `plan_addons`
(`extra_band` +N account-wide; `extra_storage` +10 GB × N on one band;
`extra_member` +N on one band) → **`profiles.band_limit_override`**, which when
non-null is a **FLOOR** under the result: the limit becomes
`greatest(override, plan base + extra_band addons)`. It raises an allowance the
plan would not give and never caps one that is already higher.

Note both halves of that, because both were wrong before 2026-09-21. The column
is `band_limit_override`, NOT `profiles.band_limit` — that second one belongs to
the pre-plans code path, stays `NOT NULL DEFAULT 3` so a rollback needs no data
migration, and the plan system never reads it (§5, §7). And the rule is a floor,
not a replacement: as a replacement it was also a cap, so a grandfathered
account on override 3 who bought Band+ (5) resolved to 3, and an `extra_band`
addon on such an account granted nothing at any quantity. The money moved; the
capacity did not.

The same rule lives in `effective_band_limit()` in the database
(`supabase/migrations/20260921_band_limit_override_floor.sql`, applied by hand)
and in `resolveEntitlements()` (`lib/entitlements.ts`). **All three must agree.**
While they do not, the app offers a band the trigger then refuses with `BL001`.

> **This actually happened, and it is the trap to watch for.** `20260807`
> installed the plan-aware `enforce_band_owner_limit()` and
> `create_band_with_owner()`. The `20260817` hotfix then ran *after* it and did
> `create or replace` on exactly those two, returning them to reading
> `profiles.band_limit`. `20260921` was applied later still, but by design it
> replaces only `effective_band_limit()` — so it upgraded a function nothing
> called. The database sat with a current resolver and two pre-plans callers,
> and an account on Band+ with an `extra_band` addon resolved to 6 in the app
> and was refused at 3 by Postgres. Restored by
> `20260923_band_limit_restore_plan_aware.sql`, which carries sections 2 and 3
> of `20260807` and deliberately **omits its section 1** — re-running the whole
> file would silently regress the override back to replacement semantics. When
> a limit refusal and the UI disagree, check which *version* of each of the
> three objects is live before anything else:
> `select proname, prosrc ilike '%effective_band_limit%' from pg_proc …`.

**Band capabilities always come from the band
OWNER's plan**; members inherit them, and a member's own plan governs only
bands they own. Ownership is `band_members.role = 'owner'` everywhere.

**Plan state is derived, never stored.** `active` / `grace` / `enforced`,
computed on read from `profiles.plan`, `grace_until` and the actual data.
**There is no cron job.** `settleAccount()` (`lib/bandFreeze.ts`) is what makes
"and the actual data" true, and every endpoint a plan banner renders from calls
it first — `GET /api/me/plan` and `GET /api/dashboard`. It clears a deadline
that no longer means anything, freezes the excess once grace has run out, and
**starts** a period when the account is over its owned-band limit with no clock
running. That last case is not hypothetical: `grace_until` is otherwise written
only by `changePlan()` on a downgrade, so an account that went over the limit
any other way (an addon revoked, `band_limit_override` lowered) sat in `active`
indefinitely — over its limit, with no banner and nothing frozen. A band nobody opens does not get frozen in the
background — it freezes the moment someone touches it, the same lazy pattern
the preview-mix cache uses. `ensureBandFreezeState()` runs from the auth
guards (writes) and from `GET /api/bands/[id]` (opening a band).

**Enforcement is server-side, everywhere** (`lib/planGuards.ts`). Band
creation (`lib/bandLimit.ts`), adding a member (join-request approval),
uploads (`storageRefusal()` on every presign/process/upload/resource path),
version creation, and the gated-feature endpoints (`POST /api/tracks/[id]/edit`
→ `track_edit`; `POST /api/projects/[id]/merge` → `cherry_pick`, but only when
selective fields are present — applying a whole version stays free). Every
refusal is `403 { error: 'limit_reached', limit_type, limit, current, message }`
so the UI can name the ceiling instead of showing a generic error.
⚠ **In-app chord detection runs entirely in a browser worker
(`public/workers/chordsWorker.js`) and has no server endpoint**, so
`chord_detect` is gated in the UI only; the public `/tools/chord-detector`
route is deliberately ungated (no login, marketing funnel, rate-limited).

**Frozen bands** (`lib/bandFreeze.ts`) are READ-ONLY; **nothing is ever
deleted**. Viewing, playback, downloads and chat history keep working. Writes
are blocked in `requireBandMember` **by HTTP method**, so every existing
mutation route and every future one is covered without remembering — pass
`{ readOnlyRequest: true }` for the handful of POSTs that are actually reads
(merge preview, preview-mix recompute). Band-level routes call
`frozenBandRefusal(bandId)` explicitly.

**Four writes are deliberately allowed in a frozen band**, and they share one
reason: each REMOVES something, so it reduces what the owner's plan has to
cover, and it destroys nothing the user wanted kept — the user is the one
asking. Without them a frozen band could not shrink, and the only way out of
the state freezing exists to avoid would be deleting the whole space.

| Allowed | How |
|---|---|
| `DELETE /api/bands/[id]` | no frozen check on the route (its PATCH sibling has one) |
| `DELETE /api/bands/[id]/members/[userId]` | no frozen check (its PATCH sibling has one); also the only way to clear a `too_many_members` conflict |
| `DELETE /api/tracks/[id]` | `requireBandMemberForTrack(req, id, { allowFrozenDelete: true })` |
| `DELETE /api/versions/[id]` | `requireBandMemberForVersion(req, id, { allowFrozenDelete: true })` |

`allowFrozenDelete` is ignored for anything that is not a DELETE, so a route
cannot unblock a POST by passing it. It is NOT `readOnlyRequest`, which means
something else entirely ("this POST is actually a read") — do not reuse that
flag here. Everything else stays refused: uploading, recording, editing a
track, creating a version, renaming, chat.

The two track/version deletes then call `settleAfterFreeingSpace(bandId)`
(`lib/planSettle.ts`), and `DELETE /api/bands/[id]` calls `settleAccount()`
directly, so a conflict the user just resolved clears the banner on the
response to their own action rather than on some later page load.

Unfreezing is immediate and automatic.

**Upgrade vs downgrade are asymmetric on purpose.** Upgrades are BLOCKED until
conflicts are resolved (only `too_many_members` blocks — everything else only
rises); the resolution screen removes members inline and says plainly that
their content stays. Downgrades are IMMEDIATE and unobstructed: features lock
at once, uploads and new versions pause where over limit, and `grace_until` =
now + 14 days if any structural conflict exists. **Members are NEVER removed
automatically — not on downgrade, not after grace, not ever.** Being over the
member limit blocks ADDING, nothing else.

**Dev switcher** — Preferences → Development. Selecting a plan posts to
`POST /api/me/plan`, the real flow. `/api/dev/plan` adds only what has no user
equivalent yet (force grace expiry, grant/revoke addons, set the `band_limit`
override). The component, `/api/dev/plan` **and `POST /api/me/plan`** all gate
on the single constant `DEV_PLAN_TOOLS_AVAILABLE` (`lib/devPlanTools.ts`,
`NODE_ENV === 'development'`); the routes 404 elsewhere rather than 403 so their
existence is not advertised.

⚠ **`POST /api/me/plan` must never be reachable in a deployed build.** With no
billing there is no legitimate self-serve plan assignment, so an open POST here
is a one-request grant of `band_plus` to anybody with a session — the entire
entitlement system defeated. When Stripe arrives, the dev gate is replaced by
webhook signature verification, **not removed**: the plan value must never
originate from a browser. `GET /api/me/plan` is read-only and stays open.

Routes: `GET|POST /api/me/plan`, `GET /api/me/plan/conflicts?target=`,
`POST /api/me/plan/keep-bands`, `GET|POST /api/dev/plan`.
"Subscribe" still posts `POST /api/paywall/intent` → upserts
`subscription_intents` (demand measurement, unrelated to entitlements).

The old measurement-only paywall — a `sd-paywall-test:{userId}` localStorage
toggle in `contexts/PaywallContext.tsx` that gated nothing — **is gone**.
`locked` now comes from the resolved plan.

**`usePaywallGate` has three states, not two.** `allowed` / `locked` /
`pending`, where `pending` means nothing has answered yet. It used to have two,
with "no answer" folded into "unlocked" — so every gated control in the app was
open for the whole of every page load, which is a paid feature given away on
each visit for the two that have no server check. A gate resolves to `pending`
until a real answer arrives from one of:

| source | reaches the client | covers |
| --- | --- | --- |
| `app/band/[bandId]/layout.tsx` | first rendered byte | everything in a band |
| `GET /api/projects/[id]` → `bandFeatures`, `activeVersionLimit` | with the project | mixer, authoritative |
| `GET /api/bands/[id]` → `memberLimit`, `storageLimitBytes`, `features` | with the band | band page, authoritative |
| `GET /api/me/plan` → `PlanSnapshot.resolved` | after auth + fetch | everything outside a band |

The band layout is a server component: the band id is a path segment, so the
owner's entitlements are knowable before render and there is no reason to make
the browser ask. It serves `BandPlanSnapshot`
(`components/plan/BandEntitlements.tsx`) — features AND the three band ceilings
— through `useBandPlan()`. It resolves entitlements ONLY: no usage counters, no
`settleAccount`, no conflict checks. Those are what make `GET /api/me/plan`
expensive and nothing rendered from this context needs them.

⚠ **Two kinds of null in that snapshot.** The SNAPSHOT being null means nobody
has answered — wait. A LIMIT inside it being null means answered, and the answer
is unlimited (the `Limit` vocabulary from `lib/plans.ts`). Collapsing them is how
"unlimited" and "we do not know" end up rendering the same control. A failure in
the layout resolves the snapshot to `null`, never to a concrete value.

`PlanSnapshot.resolved` exists because `provisioned` used to carry two unrelated
meanings — the server's "plan schema is not in the database" and the client's
"the fetch has not landed" — both of which unlocked everything and could not be
told apart. `provisioned` now means only what the server means by it.

Gates still resolve against the BAND's features wherever they are known, and
fall back to the *user's* plan otherwise (all the client knows), which can
under-promise inside someone else's paid band and never over-promises. Pass
`bandFeatures` where the band is known — every mixer call site does.

**A ceiling is not a feature gate, but it still gets three states.** A gated
feature is a property of one plan id. A ceiling (`bandsOwned`) is a property of
what the user has already done: it costs a `count(*)`, cannot be read off a plan
id, and is enforced twice server-side (`createBandForUser()` plus the database
trigger). That makes the server refusal the real gate — it does not make the
affordance safe to leave live while the count is in flight. Opening the create
modal, naming a band and being refused is worse than waiting a moment, so
`+ New space` renders inert until `/api/dashboard` answers, beside a grid that
is already showing skeletons in the same window.

**Which null it is decides the answer.** `bandLimit === null` while
`loadingData` means "in flight" → pending. The same null after the load means
the server could not read the limit → live, and the create refuses with the
structured `limit_reached` body. Guessing "at the limit" in either case would
show a paying user a cap they do not have, which is the one wrong answer with
no recovery.

**Every ceiling with a visible affordance has three states now**, and each one
needs BOTH of its unknowns resolved — the ceiling, and the list it is counted
against. An empty list makes any real ceiling read as roomy, so the page's own
`loading` flag is part of every pending condition:

| ceiling | affordance | counted against |
| --- | --- | --- |
| `bandsOwned` | `+ New space` (dashboard) | `bandLimit.atLimit` |
| `activeVersionsPerProject` | `+ New Version` (mixer) | branches with no `merged_at` |
| `membersPerBand` | `Approve` on a join request | `members.length` |

`storagePerBandMB` gates nothing in the UI: a ceiling that depends on the size
of a file the user has not chosen yet cannot be checked before the picker, and
the presign route already refuses on the declared size before any bytes move.
What it does need is to stop LYING while unknown — see below.

**Creating a version goes through `requestNewVersion()` and nothing else.** Six
surfaces open that modal (desktop toolbar, two mobile layouts, the tour, a
keyboard path); gating them one by one is how the next one ships ungated.

**Reject is never gated, only Approve.** Approving inserts a member and meets
`assertCanAddMember()`; rejecting never does.

**A ceiling must never be displayed as a default.** The band page used to seed
`storageLimitBytes` with `BAND_STORAGE_LIMIT_BYTES` (the legacy pre-plans 1 GB
constant, whose own docblock says not to use it as a value), so every band
reported 1 GB until the fetch landed — and a 50 GB band briefly showed a full
bar. It is `undefined` until answered and renders as `…`. The sidebar label was
literally `STORAGE · 1 GB`, a hardcoded plan number in violation of §7, and
`formatLimit()` rounded to whole gigabytes, rendering Free's 500 MB as `0 GB`
and having no way to say "Unlimited" at all. Both now go through `formatMB()`.

`PlansModal` calls `refresh()` when it opens. It is the recovery path every
locked control depends on: the snapshot is fetched once per provider mount, so
without it the modal can offer to sell a plan the user already bought.

### Billing (Stripe)

**Stripe is bolted onto the seam, not through it.** `lib/entitlements.ts` and
`lib/planGuards.ts` contain the string "stripe" zero times and must keep doing
so. The only writer of `profiles.plan` is still `changePlan()`
(`lib/planChange.ts`), and the only caller of it outside the dev switcher is
the webhook. If a limit check ever joins `billing_subscriptions`, that is the
bug.

**`POST /api/stripe/webhook` is the seam.** Signature verified before the body
is parsed; event claimed in `billing_events` for idempotency and *released*
again if the handler throws, so Stripe's retry is not silently skipped. Every
handled event funnels into one `applySubscription()` that re-states the whole
truth rather than diffing — upsert the subscription row, `changePlan(userId,
plan, { force: true })`, then `syncAddonsFromSubscription()`. The plan is
resolved from the **Price id**, never from metadata (editable in the
dashboard). The user is resolved from `billing_customers` first, metadata only
as a fallback.

⚠ **`force` exists for one caller.** By the time an event arrives the money has
moved, so refusing to grant what was paid for is the worse failure. The
pre-purchase refusal still happens in `POST /api/billing/checkout`, which runs
the same `checkPlanConflicts` before a card is touched. `POST /api/me/plan`
stays dev-gated — it was never the Stripe entry point and must not become one.

**Everything that can be outsourced to Stripe is.** Checkout Session for the
first payment (`allow_promotion_codes`, `tax_id_collection` — promo codes and
VAT are Stripe's forms, not ours); Customer Portal for the card, invoices,
billing address, plan switching, cancellation and reactivation. There is no
card form, no invoice table and no VAT form in this codebase on purpose: a
second copy of an invoice list is the one a user is looking at when it
disagrees with the real one.

**Stripe is the source of truth; `billing_subscriptions` is a mirror for
display.** Any question whose wrong answer costs money — "does this user
already have a live subscription?" — is asked of Stripe through
`findEntitlingSubscription(customerId)`, never of the table. The table is only
as current as the last webhook that landed, and the moment a guard needs it
most (a user pressing Subscribe again because the page still shows the old
plan) is exactly the moment the webhook has not landed. Reading the mirror
there produced two active subscriptions on one customer, the second invisible
to every screen in the app. `readLiveSubscription()` remains correct for
`GET /api/me/billing` and anything else that only renders.

**`past_due` still entitles the plan** (`statusEntitles`, `lib/billing/store.ts`).
Stripe is retrying and the user cancelled nothing; freezing bands on the first
failed retry would turn an expired card into something shaped like data loss.
When Stripe gives up the status becomes `unpaid`/`canceled`, the plan drops to
free through the ordinary path, and the 14-day grace period applies on top.

**Add-ons are subscription items — ONE item per add-on price.** Stripe refuses
the same price twice on one subscription, so the band split lives in the
item's metadata (`b_<band uuid without hyphens>: "<units>"`, parsed by
`lib/billing/addonItems.ts`; legacy items with `band_id` read as "all units on
that band"). `syncAddonsFromSubscription()` writes one `plan_addons` row per
(item, band), keyed by `stripe_allocation_key` = `<item id>:<band id | *>`.
Units the metadata does not place on an owned band grant nothing (fail
closed). A subscription that no longer entitles grants no add-ons. Rows with
no Stripe item (support credits, grandfathered capacity) are never touched.
Every webhook re-reads the subscription from Stripe rather than trusting the
event snapshot — add-on flows produce several `updated` events in a row.

**Adding charges NOW; the grant waits for payment** (`lib/billing/addonOrders.ts`).
The `+`/`−` steppers only stage. `POST /api/billing/addons/preview` prices the
staged set with `invoices.createPreview({ subscription_details: { items,
proration_behavior: 'always_invoice', proration_date: t } })`. ⚠ The preview
also lists invoice items already PENDING on the customer (left by the old
flow); the pending-update invoice does not charge them. So the quoted amount
is the preview's lines minus the ones whose invoice item id is currently
pending — never `preview.amount_due` (that showed $6 for a $2 add-on). The
order then stores the real invoice's `amount_due`; an unpaid invoice whose
amount differs from the quote is voided. Plus two `preview_mode: 'recurring'` previews
for the "then $Y/month" line. `POST /api/billing/addons/confirm` re-prices at
the same `t`, refuses if the figure moved (409 `amount_changed`), then makes
ONE `subscriptions.update` with `payment_behavior: 'pending_if_incomplete'`,
`proration_behavior: 'always_invoice'`, `proration_date: t`: one invoice, one
charge, and Stripe applies the items only if it is paid. Pending updates accept
no item metadata, so which band gets the new units is stored on a
`billing_addon_orders` row and written to the item by the webhook
(`invoice.paid` / `customer.subscription.pending_update_applied` →
`applyAddonOrder()`, idempotent: absolute targets from the order's
`items_before` snapshot). **Nothing is granted from a route.** Declined →
the route voids the invoice (discards the pending update) and reports it.
3D Secure → the order is `requires_action`; the browser opens the invoice's
`hosted_invoice_url` and polls `GET /api/billing/addons/orders/[id]`;
`POST …/orders/[id]/cancel` voids it. One open order per user (partial
unique index) — a double click cannot become a double charge. A declined
add-on invoice never raises the dunning banner (`isAddonOrderInvoice`).

**Removing takes effect at period end, with no refund, and is reversible.**
The item is reduced immediately with `proration_behavior: 'none'` (so the
renewal invoice cannot bill it and nothing is credited), and the paid-for
capacity is kept by an **ending grant**: a `plan_addons` row with `ends_at` =
the item's `current_period_end`, `ending_subscription_id`, and NO Stripe item
id. `readAddons()` and `effective_band_limit()` ignore it the instant `ends_at`
passes — change both together. `POST /api/billing/addons/keep` undoes it: the
units go back on the item with `none` (free — the period is paid) and the
grant is deleted; refused if the item's period no longer matches `ends_at`.
Buying what is still ending is refused (409 `keep_first`) — that would charge
twice for the same days. Subscription schedules were rejected for this: a
schedule's next phase restates every item, so a portal plan switch or an
add-on bought mid-period would be reverted at the boundary, and a phase change
voids pending updates.

⚠ The webhook endpoint must be subscribed to `invoice.paid`,
`invoice.voided`, `customer.subscription.pending_update_applied` and
`customer.subscription.pending_update_expired` in addition to the events it
already took. Without `invoice.paid` / `pending_update_applied`, paid add-ons
are never granted.

`scripts/billing/verify-addons.mjs` checks all of the above against Stripe
test mode on a test clock (refuses a live key).

**Every money figure in the app comes from Stripe.** `GET
/api/me/billing/upcoming` (`invoices.createPreview`) is the next invoice,
broken down into the plan line, each renewing add-on, and "adjustments"
(anything non-recurring — prorations left by the old flow, one-off items),
plus tax, discount and credit. `POST /api/billing/addons/preview` is what a
staged add-on change will charge. `formatMoney()` in
`components/billing/types.ts` only moves Stripe's integer minor units into
the user's locale and does no arithmetic. Do not extend this by summing
anything in the browser. No customer, no live subscription or nothing left to
bill answers `{ available: false, reason }` with a 200, and the footer then
falls back to the plan's list price from the catalog below.

**Prices come from Stripe, not from code.** There are no price strings in
`lib/plans.ts` any more (`PlanDefinition.price` / `AddonDefinition.price` were
removed — they drifted from what Stripe charged with nothing to catch it).
`lib/billing/catalog.ts` (server) reads the Stripe Price behind each
`STRIPE_PRICE_*` id — `unit_amount`, `currency`, `recurring.interval` — caches
it 10 min (Prices are immutable; a new amount is a new id and a deploy), and
never throws. Free is reported as 0 in the paid plans' currency. The browser
gets it as `prices` on `GET /api/me/plan` (`PlanSnapshot.prices`); the static
landing page gets it as a prop from `app/page.tsx` (`revalidate = 3600`).
Format only with `formatCatalogPrice()` / `formatInterval()`
(`lib/planPrices.ts`, isomorphic). An absent entry means Stripe could not be
asked: render "—" or nothing, **never a remembered number**.

**`BILLING_LIVE`** (`lib/billing/config.ts`) requires both the API key and the
webhook secret — a deployment that can take money but cannot hear about it is
the one failure that costs a user something real. While it is false the app
keeps its current behaviour: "Subscribe" writes `subscription_intents` and
shows the waitlist confirmation. The browser learns the flag from
`GET /api/me/plan` (`billingLive`); it cannot read server env and must not guess.

⚠ **Never build a job that replays current Stripe state through
`changePlan()`.** Reconciliation looks like the obvious safety net and it is a
trap: `grace_until`, `grace_keep_band_ids` and `bands.frozen_at` are HISTORY,
written by the transition that created them, and nothing records which
transition that was. Replay a subscription that has been on `band` for six
months against a profile that has drifted to `free` and `changePlan` sees a
plain upgrade — it arms a fresh 14-day grace period the user already served, and
unfreezes bands that were correctly frozen. Replay it against a profile that
matches and it lands on `direction === 'none'`, which is the branch that makes a
duplicate webhook a no-op; that part is fine, and it is also why the wrong case
is easy to miss in testing.

Effective LIMITS do reconstruct cleanly from `profiles.plan` + `plan_addons` —
`resolveEntitlements()` is a pure function of those. Account STATE does not. So
a future reconciliation must be a **separate entry point** that re-states the
plan and the addons and never arms grace, leaving `settleAccount()` — which
derives state from the data as it is now — as the only thing that starts a
clock.

⚠ **`/api/stripe` is in `PUBLIC_PREFIXES` in `middleware.ts`, and must stay
there.** Stripe carries no session, so the auth gate 307s the webhook to
`/auth` and the handler never runs — and Stripe reads a 307 as a successful
delivery, so nothing retries and nothing alerts. The route is not unprotected
by being public: it verifies the signature against `STRIPE_WEBHOOK_SECRET`
before parsing the body, which is the only gate that means anything for a
caller that can never hold a cookie.

**Coming back from Stripe is a poll, not a timer.** Checkout's `success_url`
carries the plan that was bought (`?checkout=success&plan=band`); `/billing`
shows "Confirming your payment…" from the first render and polls
`usePaywall().refresh()` with backoff (~1/2/4/8/15 s) until the snapshot says
that plan, then stops. It never renders the pre-payment plan as current, and on
timeout it says the payment was received and will land shortly. `refresh()` is
deliberately the request: it returns the new snapshot *and* invalidates the
shared `PaywallContext` one, which is what unlocks `ab_compare` and
`chord_detect` without a reload — for those two the client snapshot is the only
gate. The portal's `return_url` carries `?portal=return` and gets the same poll,
shorter and with **no** expected value: a portal change can be scheduled for
period end, so "nothing changed yet" is a correct outcome.

**Deleting a band stops its add-on billing first, or refuses.**
`plan_addons.band_id` cascades on band delete, so the row disappears while the
Stripe subscription item keeps charging with nothing left in the app that can
see it. `DELETE /api/bands/[id]` calls `removeBandScopedAddonItems(bandId)`
BEFORE the delete (`lib/billing/store.ts`: takes that band's units off the
shared item with `proration_behavior: 'none'` — no credit, per the Refund
Policy; it used to credit the unused days), and a failure
there **blocks the deletion** with a 502 — the same trade account deletion
makes, because a refused delete is a retry and billing for a band that no longer
exists is not recoverable from this side. A band with no Stripe-backed add-ons,
or a deployment with `BILLING_LIVE` false, touches Stripe not at all.

Migration: `supabase/migrations/20260920_billing_stripe.sql` (manual, §5),
then `20260921_plan_addons_unique_stripe_item.sql` (manual, §5 — replaces
the PARTIAL unique index on `plan_addons.stripe_subscription_item_id` with a
plain UNIQUE constraint; until it runs, **every addon purchase raises 42P10**
in `syncAddonsFromSubscription()` and the paid-for row is never written) and
`20260921_band_limit_override_floor.sql` (manual, §5 — makes
`band_limit_override` a floor in `effective_band_limit()`; pairs with
`lib/entitlements.ts`, apply together), and
`20260924_addon_charge_now.sql` (manual, §5 — `plan_addons.stripe_allocation_key`
/ `ends_at` / `ending_subscription_id`, unique key moved from the item id to
the allocation key, `effective_band_limit()` ignores expired ending grants, new
`billing_addon_orders` table. **Run it before deploying the add-on code** — the
sync upserts on `stripe_allocation_key`).
Routes: `POST /api/billing/checkout`, `POST /api/billing/portal`,
`POST /api/billing/addons/preview`, `POST /api/billing/addons/confirm`,
`POST /api/billing/addons/keep`, `GET /api/billing/addons/orders/[id]`,
`POST /api/billing/addons/orders/[id]/cancel`, `GET /api/me/billing`,
`GET /api/me/billing/upcoming`, `POST /api/stripe/webhook`.
`POST /api/billing/addons` answers 410 — the old charge-later endpoint.
Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_{SOLO,BAND,BAND_PLUS}`,
`STRIPE_PRICE_EXTRA_{BAND,STORAGE,MEMBER}`.

### Subscription UI

Ported from the design kit in `sonicdesk_designs`. **Two routes there govern
different things and neither is optional reading:**

| kit route | governs |
| --- | --- |
| `/uikit/subscriptions` | every component STATE — grace, frozen, locks, usage, conflicts, messages |
| `/subscription` | the Plan & billing SCREEN — `app/billing/` follows its layout |

The kit paints on its own palette (`--sub-bg`, `--sub-line`, `--color-primary`);
the mapping onto this app's tokens is fixed once in `components/plan/ui.tsx`
(`TONE`) and nowhere else. Shared primitives: `Eyebrow`, `StatusBadge`,
`InlineNotice`, `UsageBar`, `PlanPanel`.

**The tone goes on the container, not on four children.** A banner sets
`TONE[x].text` on its own section so the icon, the heading and any outline
button inherit it through `currentColor`. Colouring each child separately is
how a red banner ends up with an amber icon.

**These screens do not use `TbButton`.** Its shell is
`text-[10px] uppercase tracking-widest` on every variant — the app's control
idiom, right for a toolbar and wrong for a decision about money. The kit uses
body-sized text on taller buttons, so `components/plan/ui.tsx` exports the
class strings instead: `actionOutlineTone`, `actionSolid`,
`actionDestructive`, and the `…Tall` pair for the primary money CTA.
⚠ `GraceBanner` still carries private copies of two of them; fold them in.

**Body copy needs `font-body-tb`, and forgetting it is silent.** The app's
default face IS mono — `--font-sans: var(--tb-font-mono)` (globals.css) and
`html[data-theme] body { font-family: var(--tb-font-mono) }` — so a paragraph
with no font class renders monospace and *looks* deliberate. The kit sets body
copy in Inter, which is what `.font-body-tb` exists for. So: `font-mono-tb` at
9–11px for labels, meta and badges; `font-body-tb` at `text-sm leading-6` for
every sentence; `font-display-tb` for headings. The first port set explanatory
prose in 11px mono, which is the app's caption style doing a paragraph's job,
and the whole billing screen read as a terminal.

**Headings need `tracking-normal!`, with the bang.** `html[data-theme] h1…h6`
sets `letter-spacing: -0.02em` at specificity (0,1,1), which outranks a utility
class; the kit's headings sit at normal tracking. **Tailwind here is v4, where
the important modifier is a SUFFIX** — `tracking-normal!`, not
`!tracking-normal`. The prefix form is not an error, it is simply an unknown
class that does nothing, so the heading keeps the tight tracking and the diff
looks correct.

**A hairline grid needs OPAQUE cells.** The kit draws separators by filling a
`grid gap-px` wrapper with the line colour and letting opaque cells cover
everything but the 1px gaps. Give a cell a translucent face (`bg-surface/40`)
and the line colour shows through its whole area: the row renders as one grey
slab with separators you cannot see. Panels on these surfaces are `bg-surface`
at full strength — the kit maps `--sub-panel` straight to `--surface`, and
`--surface` is already only oklch 0.16 against a 0.13 page, so there is nothing
to soften.

**A 3px bar needs `bg-surface-2` as its track.** `bg-border` is the hairline
colour; as a 3px fill it is invisible, and the bar then reads as a lone lime
dash floating in nothing rather than as a proportion.

**No component may state a limit or a price.** Cards render `planLimitRows()`,
"plus:" bullets render `planUpgradeHighlights()` (a diff against the plan below
it in `PLAN_ORDER`), refusal copy comes from `lib/planCopy.ts`. The one
hand-written list is Free's *features*, because Free's value is everything that
is not gated and no constant enumerates the product.

`planTradeoffs(from, to)` exists because Free allows 3 members per band and Solo
allows 2 — one of our upgrades lowers a ceiling. Each plan card checks it
against the viewer's current plan and says so before the button, rather than
letting `too_many_members` refuse them after they have paid.

`/billing` is the one transactional screen (`app/billing/`) and it follows the
kit's `/subscription` route: hero, a two-column current-plan panel, three
headline usage tiles over a collapsible per-band breakdown, add-on ROWS with a
stepper (`components/billing/AddonRows.tsx` — the card grid it replaced was the
`/uikit` treatment, which browses rather than adjusts), then the footer.

**Add-on steppers STAGE; one button pays.** `+`/`−` never touch the account:
the row shows the new count as pending ("+1 pending", tinted row) and a sticky
summary bar lists every staged change across rows. It shows Stripe's price
("Charged now: $X — for the rest of this period" / "Then $Y/month from …") and
a single primary button with the amount in it ("Pay $X and add"; "Apply
changes" when only removing). Confirm is disabled while pricing. During
payment the steppers lock; 3D Secure shows "Confirm with your bank" (Stripe's
hosted invoice page, new tab) and "Cancel payment"; a decline says "Payment
didn't go through. Nothing was changed.", keeps the staged changes and offers
the portal. The row never shows an add-on as active until the order is
`applied`. A removed add-on shows "N ACTIVE · ENDS <date>" and "Keep it". A `+`
that could not raise any limit on the current plan (`addonHasEffect`, now in
`lib/plans.ts` so client and server share it) is disabled with
`addonWithoutEffectCopy()` beside it.

⚠ **The footer computes no total.** It renders Stripe's own next-invoice
breakdown (`GET /api/me/billing/upcoming`). The kit closes on an "estimated
monthly total" added up in the page; do not build one by summing catalog
prices in the browser — a total computed there would be a second source of
truth for money, and the invoice is the one place it must never disagree.

Preferences keeps a `<PlanUsage compact />` summary and a link; two full copies
would be two places to keep in step. `PlanUsage` is now the kit's single framed
panel and `/billing` no longer renders it — the usage tiles there come from
`/subscription`, so Preferences is its only consumer.

### Deletion safety — `lib/bandDelete.ts`

Four invariants, enforced in the API layer and (once
`supabase/migrations/20260923_deletion_invariants.sql` is applied) in Postgres:

1. A band can be deleted only when its owner is its **only** member.
2. An account can be deleted only when the user owns **no** bands.
3. A band can never become ownerless.
4. Deleting a band purges its R2 objects.

Invariants 1–3 are refusals, not errors. `DELETE /api/bands/[id]` answers 409
`{ error: 'band_not_empty', others, message }` and `DELETE /api/profile/account`
answers 409 `{ error: 'account_owns_spaces', spaces, message }` — both are
constructed by helpers in `lib/bandDelete.ts` so the wording and shape live in
one place, and `parseBandNotEmpty` recognises the band refusal on the client
**by shape, not by status**. Do not route either through
`serverErrorResponse`.

**Order matters in the band DELETE, and each step must succeed before the next:**
member guard → Stripe addon removal (blocking; a failure is a 502 and nothing is
deleted, because billing for a band that no longer exists is worse than a blocked
deletion) → `purgeBandStorage` → row delete → `settleAccount`. The storage purge
is the one step that is allowed to fail partially: it logs what it orphaned and
the deletion continues. Leaked bytes are a cost problem; a band that cannot be
deleted is a user problem.

`purgeBandStorage` generalises the per-project walk in `DELETE /api/projects/[id]`
with two deliberate deviations, both of which matter if you touch it:

- The reference scope is the **whole band**, not one project. Scoped per project,
  two projects in the same band sharing a file hash would each see the other as
  an outside reference and neither would delete it.
- Membership is tested against an in-memory `Set` of version ids rather than a
  PostgREST `.not('version_id','in','(…)')`, which would put hundreds of uuids in
  the query string.

It also removes each project's `preview_mix_storage_path`, which the original
walk does not cover. It does **not** touch `project_resources` objects — a known
gap, not an oversight.

Account deletion refuses **before** the Stripe cancel. A validation that can
refuse has to precede the first destructive step, or a refused deletion would
have already cancelled the subscription. It no longer deletes owned bands as a
side effect: the user is told which spaces to delete first, one at a time.
Destroying other people's work should take explicit, visible steps.

Removing a member is therefore the path every owner now has to take before
deleting anything, so it is not silent: `lib/memberRemoval.ts` exports
`REMOVAL_CONSEQUENCE`, the single sentence used **verbatim** by both the owner's
confirmation dialog in `app/band/[bandId]/page.tsx` and the email the removed
member gets. Keep them sharing that constant — the promise made in the dialog is
the promise delivered in the email.

`lib/email.ts` is provider-agnostic and **ships inert**: with `EMAIL_API_KEY` /
`EMAIL_FROM` unset it logs the whole message and returns
`{ sent: false, reason: 'not_configured' }`. It never throws, and notification
failures never fail the removal.

### Default entry point — `/open`

`app/open/route.ts` resolves where a signed-in user belongs: the band this
**device** last opened (cookie `sd-last-band`, written by `GET /api/bands/[id]`
where membership has just been proven), or `/dashboard`. Membership is
re-checked there on every hit and a stale hint is cleared, so a deleted band or
a removed member costs one redirect, not a 403.

`ENTRY_PATH` is what post-login (`sanitizeRedirectPath` fallback), the
middleware's already-authed `/auth` branch, the landing page's installed-PWA
redirect and `manifest.start_url` all point at. `/dashboard` keeps meaning
"show me every band" and is never rewritten — an explicit `?next=` always wins.

### Landing page & installed-PWA detection
`app/page.tsx` (force-static) renders `components/LandingPage.tsx`. The hero
artwork is `HeroVersionGraph` — an animated branch/merge graph **ported from the
promo design file** ("Promo - Stop Losing Track Versions", feature card 4a);
geometry and keyframe percentages must stay in sync with that file, the `vg-*`
keyframes live in `app/globals.css`, and label sizing uses the `--vg-u`
container-query unit so it scales with the hero column. The footer's
PRODUCT column is **derived from `LANDING_NAV_ITEMS`** (`FOOTER_PRODUCT_LINKS`)
so it can never drift from the sections the page actually has — add a section to
the nav and the footer follows. The **pricing section** (`Pricing`, `#pricing`)
is generated like the plans modal: names, limits and feature unlocks from
`PLANS` via `planLimitRows()` / `planTradeoffs()`, blurbs from `PLAN_BLURBS`
(`lib/planCopy.ts`, shared with the modal), prices from Stripe via the `prices`
prop. It used to be its own hand-written table ("$12 / $22 per member", plan
names and limits the app never had) — do not reintroduce copy that states a
limit or a price. The home FAQ's free-plan numbers are templated from
`PLANS.free` (`lib/seo.ts`) for the same reason. The landing
page forwards to `/dashboard` **only** when running as the installed app, via
`isRunningAsInstalledPWA()` (`lib/pwa.ts`). That check matches
`(display-mode: standalone)` — mirroring `display: 'standalone'` in
`app/manifest.ts`, **keep the two in sync** — plus the legacy iOS
`navigator.standalone`. It deliberately does **not** match
`(display-mode: fullscreen)` (set by any page calling the Fullscreen API, and
by Chrome for F11 — not evidence of an install) or `(display-mode: minimal-ui)`
(never requested by the manifest; the shape low-chrome in-app webviews report).
Matching those two previously redirected ordinary visitors off the marketing
page. **The redirect must never depend on auth state** — `useLandingAuth`
(`hooks/useLandingAuth.ts`) exists only to label the nav CTA; a signed-in user
in a browser tab must see the landing page. `manifest.start_url` is
`/dashboard`, so an install does not open `/` on launch anyway.

### Public tools & SEO
`/tools/chord-detector` (page `app/tools/chord-detector/`, UI
`components/tools/ChordDetectorTool.tsx`) with server API
`POST /api/tools/chord-detector` — public, rate-limited 5/hour/IP
(`lib/rate-limit.ts`, in-memory per instance), ≤10 MB, uses server-side
Essentia (`lib/serverChordDetection.ts`, `serverEssentia.ts`). SEO:
middleware 301s www/legacy hosts to the canonical origin
(`lib/site-url.ts`); `app/robots.ts` disallows all app routes (marketing
surface only); `app/sitemap.ts` is a hard-coded list with a **stable**
lastModified date (do not use `new Date()`); metadata helpers in
`lib/seo.ts`; JSON-LD in `components/seo/JsonLd.tsx`. **Legal rule: never
name competitors in any sonicdesk metadata or content.**

## 5. Database schema

> **Migrations are run manually by the project owner in the Supabase SQL
> editor — never assume a migration auto-applies. Always provide SQL
> separately from code changes.**
>
> **Corollary: these files are not evidence of what the database does.** Some
> were edited after being applied, or applied in a different form —
> `001_auth.sql`'s `handle_new_user` is a confirmed example (see `profiles`
> below). Before writing code whose correctness depends on a trigger, default,
> or constraint, read it out of the live database (`pg_get_functiondef`,
> `information_schema.columns`) rather than trusting this directory.

`supabase/migrations/` is **not a complete history**: core tables (`bands`,
`band_members`, `projects`, `versions`, `tracks`, `track_comments`,
`push_subscriptions`, `project_checklist_items`, `feedback`) predate it and
have no CREATE files here. Columns below are inferred from actual queries.

- **bands** — id, name, invite_code (unique, nullable), created_at,
  **frozen_at** (timestamptz, null = not frozen) and **frozen_reason**
  (`'plan_downgrade'`). A frozen band is read-only; nothing is ever deleted.
  Set and cleared lazily by `lib/bandFreeze.ts`, never by a background job.
- **band_members** — band_id, user_id, role (`owner`/member), role_label,
  role_color. RLS referenced by most other policies. **This table is where
  ownership lives**, so the band-limit trigger
  (`trg_enforce_band_owner_limit`) sits here, not on `bands`.
- **band_invites** — legacy token links (token, uses_count, expires_at). RLS.
- **band_join_requests** — status `pending|approved|rejected`, resolved_by;
  unique pending per (band,user). RLS.
- **profiles** — id (= auth.users.id), username (unique), display_name,
  avatar_color, **plan** (text, `free|solo|band|band_plus`, default `free`),
  **band_limit** (integer **NOT NULL default 3** — the *pre-plans* allowance,
  read only by the `main` code path. The plan system never reads it; it is kept
  populated so a rollback needs no data migration. Do not repurpose it —
  that was tried and broke production twice), **band_limit_override**
  (integer, **nullable — the plan system's MANUAL FLOOR**: non-null makes the
  owned-bands allowance `max(override, plan base + extra_band addons)` — it
  raises a plan that gives less and never caps a plan that gives more; null
  means "use the plan". It *replaced* the computation until 2026-09-21, which
  meant a grandfathered account on override 3 who bought Band+ (5) resolved to
  3 and any `extra_band` addon granted nothing. Grandfathered beta accounts and
  B2B only. **Never read it directly — go through `getEffectiveEntitlements()`**),
  **grace_until** (timestamptz, null = no
  grace period; account state is DERIVED from this and the data, never
  stored), **grace_keep_band_ids** (uuid[], the user's choice of which bands
  survive when grace ends; stale entries are tolerated and trimmed on use),
  **onboarding jsonb** (tour flags, e.g.
  `project_tour_completed`), **acquisition_source** (text, null = direct) and
  **cohort** (text, default `'cold'`; `'warm'|'cold'`) — written once at
  account creation only, see Campaign attribution in §4,
  **terms_accepted_at** (timestamptz) and **terms_version** (text) — written
  only by `handle_new_user` at account creation (see Legal pages in §4); NULL
  for accounts created before `20260923_terms_acceptance.sql`. RLS (public read,
  self update). Rows are inserted by the `handle_new_user` trigger, **not** by
  app code. ⚠ **The deployed trigger is `insert into public.profiles (id)
  values (new.id)` — nothing else** (once `20260923_terms_acceptance.sql` is
  applied: `(id, terms_accepted_at, terms_version)` with `now()` and
  `current_terms_version()`, still nothing else). `username` starts **NULL** and is first
  set by `PATCH /api/profile/username`; there is no `user_<uuid>` placeholder,
  despite what `supabase/migrations/001_auth.sql` shows. That file was never
  applied in the form it records. Verify against the database, not the file:
  `select pg_get_functiondef(oid) from pg_proc where proname =
  'handle_new_user';`
- **projects** — band_id, name, bpm, key, time_signature, stage,
  stage_since, roadmap_step_index, **preview-mix columns**:
  preview_mix_storage_path, preview_mix_status
  (`none|fresh|stale|computing`), preview_mix_generated_at,
  preview_mix_computing_started_at, main_version_modified_at.
- **versions** — project_id, parent_id, name, type `'main'|'branch'`
  (**stays 'main' forever; "Master" is display-only**), created_by,
  merged_at, merged_into_id, tag (≤20 chars).
- **tracks** — version_id, name, display_name, original_filename,
  **file_hash** (dedup key), storage_path, duration_ms, file_size_bytes,
  position, icon_emoji, icon_color, file_type `'audio'|'midi'`, midi_data
  (jsonb), midi_start_bar (legacy), **start_bar** (0 = bar 1; negative =
  pre-roll). No waveform column — bars are computed client-side
  (the `20260616_track_waveform_bars.sql` migration was reverted).
- **track_comments** — track_id, version_id, content, timecode_start_ms /
  timecode_end_ms (**track-relative**), created_by.
- **comment_replies** — comment_id, content, created_by.
- **sections** — version_id, project_id, type, custom_name, start_bar,
  end_bar, chords (text), note (≤40 chars), color, position. RLS.
- **project_resources** — type `file|link|lyrics`, storage/file columns,
  url/title/content, context_version_id, context_track_id, position. RLS.
- **project_roadmap_steps** — project_id, name (1–50 chars), position. RLS.
- **project_checklist_items** — per-project checklist rows.
- **band_messages** — see Chat in §4. RLS **and in the
  `supabase_realtime` publication** (the only table streamed to clients).
- **band_activity** — band_id, user_id, action (enum in `lib/activity.ts`),
  subject, detail, project_id. RLS.
- **push_subscriptions** — user_id, endpoint, p256dh, auth.
- **plan_addons** — user_id, band_id (nullable), addon_type
  (`extra_band|extra_storage|extra_member`), quantity, created_at. A CHECK
  enforces the scope: `extra_band` must have a NULL band_id (it is
  account-wide), the other two must name a band (storage and members are
  per-band and are never pooled). RLS: owner can SELECT; **writes are
  service-role only** — a client that could insert here could grant itself
  capacity. Stripe will insert these rows later.
- **plan_limits** — plan, bands_owned. ⚠ **A MIRROR of `lib/plans.ts`**,
  read only by the DB trigger so it can enforce the owned-bands limit without
  a round trip. The application never reads it. **Change both together** — a
  drift here does not break the app, it silently makes the DB backstop wrong.
- **subscription_intents** — user_id, plan `solo|band|band_plus`, email;
  unique (user_id, plan). RLS with **no client policies** — service-role
  writes only. Not an entitlement table (demand measurement only).
- **feedback** — inserted under the user's JWT (RLS applies).

## 6. External services & environment variables

Reference: `.env.example`. Values are set **manually** in Vercel (and
`.env.local` for dev). Server-only vars must never reach the client.

**Supabase** — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(browser client + token refresh); `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
(**server-only; bypasses RLS** — `lib/supabase.ts`).

**Cloudflare R2** (all server-only, `lib/r2.ts`) — `R2_ENDPOINT`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`.
(`R2_ACCOUNT_ID` is in `.env.example` but referenced nowhere in code.)

**Web push** — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (**server-only**),
`VAPID_EMAIL`. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is **derived from
`VAPID_PUBLIC_KEY` via the `env` mapping in `next.config.ts`** — don't set
it separately.

**Google Sheets** (all server-only, `lib/googleSheets.ts`) —
`GOOGLE_SHEETS_CLIENT_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY` (**stored with
literal `\n` sequences; the code does `.replace(/\\n/g, '\n')` — keep that
format**), `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_TAB` (optional,
default `Sheet1`).

**Analytics** — `NEXT_PUBLIC_GA_MEASUREMENT_ID` (GA4),
`NEXT_PUBLIC_META_PIXEL_ID` (Meta Pixel, optional),
`NEXT_PUBLIC_YANDEX_METRICA_ID` (Yandex Metrica counter, optional; prod
`111073087`). Set the Metrica ID in **Vercel production only** — an unset
value makes the script and every mirrored goal no-op, which is what keeps dev
and preview traffic out of the counter.

**Stripe** (all server-only — **never** `NEXT_PUBLIC_`; `lib/billing/config.ts`) —
eight variables, and they travel together: `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_BAND`,
`STRIPE_PRICE_BAND_PLUS`, `STRIPE_PRICE_EXTRA_BAND`,
`STRIPE_PRICE_EXTRA_STORAGE`, `STRIPE_PRICE_EXTRA_MEMBER`. There is one price
set per Stripe **mode**, so the scope decides the mode: Vercel **Production**
gets `sk_live_` + live price ids, **Preview** and **Development** get `sk_test_`
+ test price ids, and `.env.local` gets test values. Mixing a key from one mode
with prices from the other is the only way to get "No such price" at checkout.
`BILLING_LIVE` is `STRIPE_SECRET_KEY && STRIPE_WEBHOOK_SECRET` — test keys turn
it on exactly like live ones, and removing either turns it off, which is the
supported way to get the waitlist behaviour back.

### Testing billing locally

Stripe cannot reach `localhost`, so the webhook — the only writer of
`profiles.plan` — never fires without a forwarder. Run one:

```
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

It prints a signing secret (`whsec_…`) **for that session**. Put it in
`.env.local` as `STRIPE_WEBHOOK_SECRET` and restart `next dev`. That secret is
not the one from the Stripe dashboard's endpoint list and is not interchangeable
with it: the wrong one verifies nothing and every event answers 400.

With the key and that secret in place `BILLING_LIVE` is true locally, checkout
opens in test mode (card `4242 4242 4242 4242`), and the plan changes only when
the forwarded event arrives — which is the whole flow under test, including the
post-checkout confirmation poll on `/billing`.

**Site** — `NEXT_PUBLIC_SITE_URL` (canonical origin; prod
`https://sonicdesk.studio`). Runtime also reads `NODE_ENV`, `VERCEL_ENV`.

## 7. Critical conventions & gotchas

- **ffmpeg on Vercel:** any API route that runs ffmpeg/ffprobe MUST be
  listed in `ffmpegRoutes` in `next.config.ts`
  (`outputFileTracingIncludes`), or the binary won't ship with the function.
  Only the linux/x64 ffprobe binary is traced — don't widen the glob
  (function size limit).
- **SQL migrations are manual** (Supabase SQL editor). Provide SQL
  separately; never assume it ran. New Realtime tables additionally need
  `alter publication supabase_realtime add table <t>;` — RLS alone isn't
  enough, and only `band_messages` is enabled today.
- **Service-role bypasses RLS.** Every route touching band data must call
  `requireBandMember` / `requireBandMemberForVersion` /
  `requireBandMemberForTrack` (`lib/supabase/server.ts`) before reading or
  writing. RLS only protects direct client reads (Realtime).
- **Any new third-party script must be added to the CSP** in
  `lib/securityHeaders.ts` (`script-src`, plus `connect-src`/`img-src`/
  `frame-src` as the vendor requires). The headers are only applied to real
  responses, so a missing entry passes local dev and fails **silently in
  production** with "Refused to load … violates directive" in the console —
  this is exactly how the Yandex Metrica tag was blocked on first deploy.
- **Never hardcode colors.** Use the CSS variables from `app/globals.css` /
  `app/design-system.css` (light + dark + multiple palettes via
  `PaletteContext` / `lib/design-theme.tsx`). `/uikit` is the living
  reference.
- **In the product a band is a SPACE, and that is display-only too.** No
  user-facing string inside the app says "band" — it says "space". The landing
  pages are the exception and keep the musicians' word. Everything underneath
  stays `band`: the tables (`bands`, `band_members`), the columns
  (`bandsOwned`, `membersPerBand`), the routes (`/api/bands/[id]`,
  `/api/me/plan/keep-bands`), the analytics parameter values
  (`limit_type: 'bands'`), the `PlanId` `'band'` and the `AddonType`
  `'extra_band'` — those are data and wire format, and a wording change must
  never reach them. ⚠ A blanket find-and-replace WILL break this: `bands.` and
  `band.` are property access, `band:` is an object key, and `'band'` is a
  `PlanId` written to `profiles.plan` and mapped to a Stripe Price. Change
  strings, by hand, and let `tsc` confirm nothing else moved. "Bandmate" is a
  person, not a space — leave it or reword the sentence.
- **Every subscription control reports through `usePlanTracking()`**
  (`contexts/PaywallContext.tsx`), not through a bare `trackEvent`. It injects
  `current_plan`, `plan_state` and `billing_live` into each event, so no call
  site has to remember the one thing every subscription question needs: which
  plan the person was on when they did it. The key is `current_plan` and NOT
  `plan`, because several events already use `plan` for the tier being acted on
  — a card someone pressed Subscribe on, the tier a limit belongs to — and
  reusing the name would have the viewer's own plan overwrite the target. The
  returned function is referentially stable, so it is safe in a dependency
  array; that is deliberate, since one of its callers reports "modal opened"
  from an effect and an unstable identity would re-count it on every refresh.
- **Git→music terminology is display-only.** branch→version, main→Master,
  merge→apply. DB values stay `'main'`; resolve display names only via
  `getVersionDisplayName()`. "Master" is a reserved version name.
- **Two AudioContexts:** shared 48 kHz playback context
  (`lib/audioContext.ts`; everything audible goes through the single master
  GainNode — separate edges to destination hang Chrome) and a separate
  recording context at **hardware rate** (`lib/recordingAudioContext.ts`;
  do not pin a sample rate — pinning 22050 caused glitchy monitoring).
- **Audio-affecting mutations must call `markPreviewMixStale(projectId)`**
  (track add/remove/replace/edit, start_bar, bpm/time-signature, merges).
- **Comment timecodes are track-relative**, not project-timeline; convert
  with `startBarToMs`/`msToBar` when displaying bars.
- **Track files are deduplicated by `file_hash`** across a project
  (`projects/{id}/{hash}.flac`) — deletion logic must check for other rows
  sharing the hash before removing the R2 object.
- **R2 temp-key formats are load-bearing:** presign and process routes must
  agree exactly (`lib/r2TempKey.ts`).
- **Never interpolate a filename into a header.** HTTP header values are
  latin-1, so a Cyrillic (or any non-ASCII) project / track / resource name in
  `Content-Disposition` makes the `Response` constructor throw
  `ERR_INVALID_CHAR` — which surfaces as a **500 on an otherwise-successful
  download**, and only for the users whose names aren't ASCII. Always build the
  value with `attachmentDisposition()` (`lib/contentDisposition.ts`), which
  emits both the stripped ASCII `filename` and the RFC 5987
  `filename*=UTF-8''…` form. Percent-encoding the whole name is not a fix: it
  stops the throw but hands the user `%D0%9C%D0%BE%D1%8F.wav`.
- **Rate limiting is in-memory per serverless instance** (`lib/rate-limit.ts`)
  — best-effort only.
- **Web fetches of Next docs:** this Next version differs from training
  data; check `node_modules/next/dist/docs/` (see the block at the top).
- **Campaign attribution is immutable after account creation.** Only
  `PATCH /api/profile/username` may write `profiles.acquisition_source` /
  `cohort`, and only under its placeholder-username guard. No other route may
  set or update them (see §4). The trusted input is the `sd-campaign` cookie
  set by `middleware.ts`, resolved through the registry server-side — never
  store a client-supplied source without bounding it.
- **RLS is row-level, not column-level.** `profiles` carries a self-update
  policy (`using (auth.uid() = id)`), so the browser can write that table
  directly — `PreferencesModal` does, for `username`. A policy chooses *rows*;
  only a GRANT chooses *columns*. Every entitlement column therefore lives
  behind a column grant, applied by
  `supabase/migrations/20260806_lock_entitlement_columns.sql`: `authenticated`
  may update `username`, `display_name`, `avatar_color`, `onboarding` and
  nothing else (and, since `20260923_terms_acceptance.sql`, cannot INSERT into
  `profiles` at all). **Adding a user-editable column to `profiles` means adding it to
  that grant; adding any other column means leaving it out.** Never add a
  privileged field to a table a client can update without checking the grant.
  **No client component writes `profiles` any more** — `PreferencesModal`'s
  rename goes through `PATCH /api/profile/username` like onboarding does.
  `AuthContext` still SELECTs it, which is unaffected. Keep it that way: a
  server route with a field allowlist is the only shape of profile write.
- **`file_size_bytes` is enforcement state, not metadata.**
  `getBandStorageUsed()` sums it, so a client-writable byte count is a storage
  ceiling that can be pushed to infinity with one negative number. It is written
  only by the paths that produced the bytes (`tracks/process`, `tracks/upload`,
  `tracks/edit`, `resources/process`), always from the buffer they just hashed —
  never from a request body, not even as a fallback. It is deliberately absent
  from the `PATCH /api/tracks/[id]` field allowlist.
- **A declared size is not a size.** Presign routes take the client's
  `fileSize` for an early 413/quota refusal, but the authoritative number is
  read from the stored object after upload. Checking a quota against a declared
  size and then recording that declared size lets a 500 MB file count as 1 byte.
- **Never return a database error to the client.** `serverErrorResponse()`
  (`lib/apiErrors.ts`) logs the real error under a `[scope]` prefix and returns
  a written sentence. Postgres `message`/`details`/`hint` name tables, columns
  and constraints, and the band-limit routines attach `DETAIL: limit=<n>
  current=<n>` — handing a caller the shape of the rule refusing them.
  `String(err)` from an ffmpeg/R2 path leaks filesystem paths and bucket keys.
  ⚠ **Structured refusals are not errors** — `{ error: 'limit_reached', … }` and
  `{ error: 'band_frozen', … }` come from `limitRefusalResponse()` and must
  never go through this helper; `lib/planCopy.ts` parses them by shape.
- **Object keys are derived, never accepted.** `storage_path` from a request
  body is a write primitive over the whole R2 bucket — band membership
  authorises the request, not the key. `PUT /api/tracks/[id]/midi-upload`
  computes the key from the track's project plus a hash of the received bytes
  and returns it; `PATCH /api/tracks/[id]` validates `storage_path` and
  `file_hash` with `isValidProjectObjectKey()` / `isValidFileHash()`
  (`lib/r2.ts`) against the canonical `projects/{thisProject}/{sha256}` shape.
- **Routes that authenticate by hand do not get the frozen-band block.** It
  lives in `requireBandMember` and keys off the HTTP method. Any route that
  checks `band_members` itself must call `frozenBandRefusal()` /
  `isBandFrozenForWrite()` explicitly — the resources routes and the
  member-role route did not, and were writable in a frozen band.
- **An accent used outside the landing page must be declared at the theme
  root.** `--wave-amber`, `--wave-mint` and `--wave-violet` lived only inside
  `.landing-page` (globals.css) while `TONE` (`components/plan/ui.tsx`) used
  them on every subscription surface, so outside the landing page they resolved
  to nothing — and an undefined var inside a colour throws no error and logs
  nothing. `color: var(--missing)` falls back to inherit; `border-color:
  color-mix(… var(--missing) …)` falls back to currentColor. The grace banner
  therefore rendered WHITE and looked deliberate. They are now declared in
  `:root` in `app/design-system.css` (with darkened values for the three light
  themes) and registered in the `@theme` block, which is what makes
  `text-wave-amber` a real utility. **Use the registered token, never
  `text-[var(--wave-amber)]`** — the arbitrary form fails the same silent way if
  the variable ever moves again. `--wave-coral` and `--wave-sky` are still
  landing-only on purpose; nothing outside `.landing-page` may reference them.
- **Never hardcode a plan limit.** `lib/plans.ts` is the only place a limit,
  feature or price is written. Every check reads it through
  `getEffectiveEntitlements()` / `getBandEntitlements()`. The one deliberate
  duplicate is the `plan_limits` table (§5), which exists solely for the DB
  trigger — change both together.
- **Two band-limit columns, on purpose.** `profiles.band_limit` (NOT NULL
  default 3) belongs to the pre-plans path; `profiles.band_limit_override`
  (nullable) is the plan system's override, where non-null means "this account
  never drops below this number" — a floor, resolved as
  `max(override, plan base + extra_band addons)`, not a replacement and not a
  cap. The same rule lives twice more, in `resolveEntitlements()`
  (`lib/entitlements.ts`) and in `effective_band_limit()` (the DB trigger's
  backstop, `20260921_band_limit_override_floor.sql`) — **change all three
  together**, or the DB refuses a band the app just allowed. They are separate
  columns because sharing one column broke
  production twice: dropping the default gave new profiles a NULL that the old
  code fails closed on, and the leftover value `3` then read as an override
  that silently disabled every plan limit in the system. Read neither
  directly — go through `getEffectiveEntitlements()`. Any new code path that
  inserts into `bands` (or writes an owner row into `band_members`) must go
  through `createBandForUser()` in `lib/bandLimit.ts`.
- **The plans schema rolls out in two phases.**
  `20260806_subscription_plans.sql` is additive only and safe to apply while
  the old code is live; `20260807_plans_db_enforcement.sql` swaps the DB
  routines and must come *after* the deploy. Keep it that way — anything that
  changes a column or routine the deployed code reads belongs in phase 2.
- **Membership is never capped.** Joining someone else's band is unlimited on
  every plan, free included. Do not add a `bandsJoined` limit, and do not
  count non-owner memberships in any entitlement code.
- **Storage is per band and is never pooled.** Do not sum a user's bands, do
  not add an account-wide storage total, and do not let an `extra_storage`
  addon apply account-wide (the DB CHECK rejects it).
- **Members are never removed automatically.** Not on downgrade, not when
  grace expires, not ever. Over-limit blocks ADDING and nothing else.
- **A frozen band must not be writable by any path.** The block lives in
  `requireBandMember` and keys off the HTTP method, so new mutation routes are
  covered automatically — but a route that authenticates some other way must
  call `frozenBandRefusal()` / `assertBandWritable()` itself. If you add a
  POST that is actually a read, pass `{ readOnlyRequest: true }` rather than
  removing the guard. Band DELETE stays allowed on purpose.
- **Plan state is derived and evaluated lazily.** No cron job, no `state`
  column. If you need "is this frozen / in grace", call the resolver; do not
  cache the answer across requests.
- **A pending paywall gate must not render the real control at all** — not
  even DOM-disabled. `disabled` is an attribute, and an attribute is one
  devtools edit (or one `….disabled = false`) away from being gone; for
  `ab_compare` and `chord_detect` there is no server behind it, so that edit IS
  the feature. The pending branch renders its own inert element carrying no
  `onClick` — React never attached a handler, so there is nothing in the DOM to
  re-enable — plus `paywallPendingProps` (`tabIndex: -1`, `aria-disabled`) so a
  keyboard user cannot reach it either. `guard()` from `usePaywallGate` wraps
  the real action as a second line of defence. Never use the LOCKED treatment
  for pending: a lock is a claim we cannot make yet, and flashing one over a
  feature a paying user owns is the failure this state exists to prevent.
- **A locked control is dimmed, never DOM-disabled** (`PaywallLock.tsx` rule 1).
  The click is the whole point — it opens the plans modal and records the
  demand signal. A dimmed control that does nothing when pressed reads as a bug
  and measures as silence. This applies to the band-limit affordances on the
  dashboard too, not only to feature locks.
- **Never name competitors** in any metadata, landing copy, or content
  (legal requirement; /vs pages were removed for this reason).
- **No test suite exists** — verify with `npm run build` and `npm run lint`.

## 8. How to add a new feature (observed patterns)

1. **API route:** `app/api/<resource>/[id]/<action>/route.ts`. Start with
   the auth guard (`requireBandMember*`), validate the body by hand (no zod
   here), return `NextResponse.json`. Use the service-role `supabase` from
   `lib/supabase.ts` for queries. Log noteworthy actions with
   `logActivity()`; call `markPreviewMixStale()` if audio changes; check
   `checkBandStorageQuota` before accepting bytes.
2. **DB change:** write a dated SQL file in `supabase/migrations/`
   (`YYYYMMDD_name.sql`, idempotent `if not exists` style, RLS policies
   scoped through `band_members`), and hand the SQL to the owner to run
   manually. Realtime tables also need the publication statement.
3. **UI:** components go in `components/` (flat) or an existing subfolder;
   use `components/design/` primitives (TbButton, TbModal, HoverTooltip)
   and CSS variables. Mixer features usually mean editing the project
   page monolith — keep heavy logic in `lib/` modules like existing
   features do.
4. **Analytics:** add snake_case `trackEvent('thing_happened', {...})`
   calls at user-intent points, consistent with the existing taxonomy.
5. **Gated by plan?** Add the key to `GatedFeature` in `lib/plans.ts` (and to
   the plans that include it), wrap the entry point with `usePaywallGate` +
   `PaywallLockWrap`, **and gate the server endpoint** with
   `assertBandFeature(bandId, feature)`. The UI lock is presentation; the
   server check is the gate. If the feature has a new limit, add it to
   `lib/plans.ts`, resolve it in `lib/entitlements.ts`, enforce it in
   `lib/planGuards.ts`, and word it in `lib/planCopy.ts` — never inline.
6. **ffmpeg?** Add the route to `ffmpegRoutes` in `next.config.ts`.
7. **Docs:** update this file (see the rule at the top), then verify with
   `npm run build`.
