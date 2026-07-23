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

There is currently **no billing** (a measurement-only test paywall exists,
see §4) and **no native mobile app** — no Capacitor/Android code exists in
this repo; mobile is the responsive web experience.

## 2. Tech stack

- **Next.js 16.2.7** (App Router, TypeScript 5, React 19.2.4) — heed the
  block above; read `node_modules/next/dist/docs/` before assuming APIs.
- **Vercel** hosting (serverless functions; env vars set manually there).
- **Tailwind CSS 4** via `@tailwindcss/postcss` + a large hand-rolled CSS
  variable design system (`app/globals.css`, `app/design-system.css`).
- **Supabase** (`@supabase/supabase-js` v2) — Postgres, magic-link auth,
  Realtime (chat + presence). No generated DB types; queries are untyped.
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
  + **@vercel/analytics** (all wired in `app/layout.tsx`).
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
  analytics.ts              trackEvent wrapper (GA4 + Meta Pixel mirror)
  audioContext.ts / recordingAudioContext.ts   The two-AudioContext pattern
  midi.ts, midiRender.ts, midiSoundfont.ts     MIDI engine
  serverEssentia.ts, serverChordDetection.ts, chordDetection.ts, chords.ts
  activity.ts               logActivity (band activity feed)
  bandStorage.ts            1 GB per-band storage quota
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
Magic link (Supabase auth) from `app/auth/page.tsx`; callback page posts
tokens to `POST /api/auth/session`, which verifies them and sets **HttpOnly
cookies `sb-at` / `sb-rt`** (`lib/auth/session.ts`, `cookie-options.ts`).
`middleware.ts` verifies/refreshes on every request and forces the onboarding
flow until `user_metadata.username` and `user_metadata.onboarding_complete`
are set. Onboarding (`app/onboarding/page.tsx`) is 3 steps: theme → username
(`/api/profile/username`, `/api/auth/username-check`) → create or join a band
(`/api/profile/complete-onboarding`). Feature-tour completion flags live in
`profiles.onboarding` (jsonb) via `/api/profile/onboarding`; tours are in
`components/onboarding/ProjectTour.tsx` + `featureTourSteps.ts` /
`mobileProjectTourSteps.ts`.

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
`GET /api/versions/[id]/export` — all stems converted FLAC→WAV
(`flacToWav`), each padded/trimmed by its `start_bar` offset converted to ms,
streamed as a ZIP via archiver.

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
`PREVIEW_STUCK_LOCK_MS`); `.../preview-mix/recompute` forces it. Client
cache/preload: `lib/previewMixClient.ts`. Used by the band page and
Rehearsal View.

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

### Analytics (GA4 + Meta Pixel)
Always use `trackEvent(name, params)` from `lib/analytics.ts` — it sends to
GA4 (`window.gtag`) and mirrors to Meta Pixel, adding `app_version`.
~80 snake_case events exist; follow the taxonomy
(`noun_verb`/`noun_verb_past`): e.g. `project_opened`, `merge_completed`,
`comment_created`, `paywall_modal_opened`, `recording_saved`,
`tour_skipped`. Page views: `components/analytics/PageViewTracker.tsx`.
GA/Pixel/Vercel Analytics are mounted in `app/layout.tsx`.

### Feedback modal
`components/feedback/` → `POST /api/feedback` (type
`positive|negative|bug`, 10–2000 chars). Inserts into Supabase `feedback`
**under the user's JWT** (RLS applies) and best-effort mirrors a row to a
Google Sheet (`lib/googleSheets.ts`; columns Timestamp|Email|Type|Message|
Page URL; tab from `GOOGLE_SHEETS_TAB`, default `Sheet1`). Sheet failure
never fails the request.

### Paywall test mode (measurement only)
`contexts/PaywallContext.tsx` — a per-user localStorage toggle
(`sd-paywall-test:{userId}`, surfaced in Preferences → Testing). **Purely
presentational; nothing is gated server-side.** Gated features:
`chord_detect`, `cherry_pick`, `track_edit`, `ab_compare`
(`components/paywall/PaywallLock.tsx`, `PlansModal.tsx`). "Subscribe" posts
`POST /api/paywall/intent` → upserts `subscription_intents`
(plan `solo|band|band_plus`, unique per user+plan, email resolved
server-side). Not an entitlement table. NOTE: plan band-limits shown in the
plans UI have known inconsistencies to resolve before real billing.

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

`supabase/migrations/` is **not a complete history**: core tables (`bands`,
`band_members`, `projects`, `versions`, `tracks`, `track_comments`,
`push_subscriptions`, `project_checklist_items`, `feedback`) predate it and
have no CREATE files here. Columns below are inferred from actual queries.

- **bands** — id, name, invite_code (unique, nullable), created_at.
- **band_members** — band_id, user_id, role (`owner`/member), role_label,
  role_color. RLS referenced by most other policies.
- **band_invites** — legacy token links (token, uses_count, expires_at). RLS.
- **band_join_requests** — status `pending|approved|rejected`, resolved_by;
  unique pending per (band,user). RLS.
- **profiles** — id (= auth.users.id), username (unique), display_name,
  avatar_color, **onboarding jsonb** (tour flags, e.g.
  `project_tour_completed`). RLS (public read, self update).
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
- **subscription_intents** — user_id, plan `solo|band|band_plus`, email;
  unique (user_id, plan). RLS with **no client policies** — service-role
  writes only. Not an entitlement table.
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
`NEXT_PUBLIC_META_PIXEL_ID` (Meta Pixel, optional).

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
- **Never hardcode colors.** Use the CSS variables from `app/globals.css` /
  `app/design-system.css` (light + dark + multiple palettes via
  `PaletteContext` / `lib/design-theme.tsx`). `/uikit` is the living
  reference.
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
- **Rate limiting is in-memory per serverless instance** (`lib/rate-limit.ts`)
  — best-effort only.
- **Web fetches of Next docs:** this Next version differs from training
  data; check `node_modules/next/dist/docs/` (see the block at the top).
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
5. **Paywall (if gated):** add the feature key to `PaywallFeature` in
   `contexts/PaywallContext.tsx` and wrap the entry point with
   `PaywallLock`; remember it's presentation-only.
6. **ffmpeg?** Add the route to `ffmpegRoutes` in `next.config.ts`.
7. **Docs:** update this file (see the rule at the top), then verify with
   `npm run build`.
