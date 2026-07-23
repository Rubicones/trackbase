# Refactor report — Page 1: Mixer (project page)

Behavior-preserving decomposition of `app/band/[bandId]/project/[projectId]/page.tsx`
(8,067 → 3,586 lines). **STOPPED here for review before touching any other page.**

## Method (why this is safe)

Every extraction was done by copying exact line ranges out of the original file
with `sed` — no logic was retyped or rewritten. The only textual changes to
moved code are (a) an added `export` keyword on top-level declarations (no
runtime effect) and (b) the four documented dead-code deletions below. This was
then **verified programmatically**: a script confirmed every extracted body is
byte-identical to its original line range, and that the `ProjectPage` component
body (lines 4621–8067 of the original) survived byte-for-byte unchanged in the
new page.tsx. `tsc --noEmit` passes; eslint unused-vars count in the directory
is now 0. Audio parameters (RAMP_SECS, sample rates, scheduler timing, the
two-AudioContext split) were moved verbatim, never edited.

## 1. Files changed

- `page.tsx` — became the orchestrator: kept `ProjectPage` (byte-identical),
  `sheetBtnStyle`, `MAX_CONCURRENT_UPLOADS`, `MAX_AUTH_RETRIES`; everything
  else moved out; import block pruned of 30+ now-unneeded or dead specifiers.
- `MergeModal.tsx` — removed two unused imports only (`useTheme`,
  `MergePreview` type); no logic touched.
- `AGENTS.md` — directory map + mixer section updated to the new structure.

## 2. New files created (all in the same route directory)

- `usePlayer.ts` (1,248 ln) — the playback engine hook, verbatim, incl.
  `RAMP_SECS` and `RehearsalPlaybackOptions`. Highest-risk unit; moved
  wholesale precisely so its internals did not change.
- `TrackRow.tsx` (1,078 ln) — `TrackRow` (React.memo) + file-private
  `TrackColorPicker`: offset drag, seek-on-click, rename, drawer, piano roll.
- `Waveform.tsx` (316 ln) — waveform decode/render + drag-to-comment.
- `commentLayer.tsx` (261 ln) — `isCommentUiTarget`, `CommentToggleBtn`,
  `CommentRangeMarker`, `CommentInputBubble`.
- `MasterPlayerBar.tsx` (209 ln) — transport bar (rAF-driven progress).
- `Sidebar.tsx` (299 ln) — version history / resources / storage meter.
- `modals.tsx` (177 ln) — `NewBranchModal` (incl. the reserved-"Master"
  validation), `DeleteVersionModal`.
- `skeletons.tsx` (124 ln) — `TrackRowSkeleton`, `MobilePortraitSkeleton`.
- `UploadRow.tsx` (102 ln) — upload progress row.
- `mixerChrome.tsx` (167 ln) — `TbBtn`, toolbar group/separator,
  `TrackLetterBtn`, `ActionButton`, small icons, `TransportToggle`.
- `mixerUtils.ts` (176 ln) — formatters (`fmtSize/fmtTime/fmtMs/fmtDate/
  formatBytes`), bar math (`durationMsToBars`, `trackContentDurationMs`,
  `trackTimelineEndSec`), clip layout constants/functions, version-tag styles,
  `uploadToR2Direct`, `MAX_PROJECT_BARS` + recording-extend constants.
- `mixerTypes.ts` (26 ln) — `UploadStatus`, `UploadItem`, `ActiveCommentInput`.

Import graph is one-directional (page → modules → lib); no cycles.

## 3. Dead code removed (each verified 0 references by whole-word search across the repo; none were exported before)

- `calculateProjectTotalBars` — declared, never called (page computes
  `baseProjectBars` inline instead).
- `InstrumentType` / `detectInstrument` / `InstrumentSVG` — an abandoned
  instrument-icon feature; never referenced.
- `ThemeToggle` — never rendered (theme switching happens elsewhere).
- `TrackIconBtn`, `ChevronRightIcon` — never rendered.
- `versionTagLabel` — superseded by `versionTagStyle`; never called.
- `ProjectPageSkeleton` + `MobileLandscapeSkeleton` + `DesktopPageSkeleton` —
  the wrapper was never rendered, and the latter two were referenced *only* by
  the wrapper (the page renders `MobilePortraitSkeleton` and
  `TrackRowSkeleton` directly). ~360 lines.
- Unused imports in the original page: `createPortal`, `gmProgramLabel`,
  `gmInstrumentName`, `sixteenthsPerBar`; plus `useTheme`/`MergePreview` in
  MergeModal.
- `dotTopOffset` chain: `computeOverlapOffsets()` was computed per Waveform
  render and passed as `CommentRangeMarker`'s `dotTopOffset` prop, which the
  component **never reads**. Removed the pure computation, the prop, and the
  helper. DOM output is provably unchanged (the value influenced nothing).
- `replyCount` local in `CommentRangeMarker` — computed, never read.

## 4. Duplication consolidated

Nothing merged this pass — deliberately. Candidates inspected and **rejected
as not-identical** (per the rule that subtle differences mean they are not
duplicates):

- `fmtSize` vs `formatBytes` — different units/rounding (KB 0dp + MiB
  threshold vs KB/MB/GB 1–2dp). Both kept, now side by side in mixerUtils.
- Inline `parseInt(timeSig.split('/')[0]) || 4` (many sites) vs
  `beatsPerBar()` in `lib/chat.ts` — differ for negative numerators
  (`|| 4` keeps -3; `beatsPerBar` returns 4). Left as-is; noted below.
- `fmtTime` here vs an identical local `fmtTime` in
  `components/CompareMode.tsx` — true duplicate, but consolidating means
  touching CompareMode (a different unit) or creating a new lib module;
  deferred to keep this change strictly scoped to the mixer page.

## 5. Optimizations applied

None. All rAF loops, memoization, effect dependencies, caching, and network
patterns are untouched. Goal-3 items that would require judgment (waveform
decode uses a throwaway `new AudioContext()` per track; per-track full-file
fetches; preview-mix caching) are listed as questions below rather than acted on.

## 6. Behavior-preservation evidence

- **Double-check (mechanical):** script-verified byte-identity of every moved
  block against its original line range; `ProjectPage` body byte-identical;
  `tsc --noEmit` clean; analytics parity — the multiset of `trackEvent(...)`
  call sites across the directory has an **identical md5** before and after.
- **Triple-check (flow traces):**
  - *Play → metronome → sync → seek:* MasterPlayerBar receives the same props
    from unchanged page JSX → `player.play()` in usePlayer runs the identical
    scheduling code (same `RAMP_SECS` ramps, same `start_bar` offset math via
    verbatim `trackTimelineEndSec`, same metronome buffer regen conditions,
    same 5 Hz state throttle + rAF `currentTimeRef`); seek still bumps
    `seekEpoch` for RecordingTrackRow (untouched file).
  - *Track offset drag:* TrackRow byte-identical; clip positioning functions
    byte-identical in mixerUtils; commit path (`onStartBarUpdate` →
    `guardMasterEdit` → PATCH) lives in the untouched ProjectPage body.
  - *Comment create:* Waveform drag → `finalizeRange` (identical thresholds/
    guards) → `CommentInputBubble` → page's `onCommentCreate` (untouched).
    Only diff in this path is the removed never-read `dotTopOffset` prop.
- Component identities unchanged: everything stayed module-level (nothing was
  moved inside a component), so React reconciliation/memo behavior is
  identical. No moved module has import-time side effects.
- `npm run build` could not complete **in this sandbox** — it fails fetching
  Google Fonts (no network to fonts.googleapis.com); the repo's own
  `build_out.log` shows builds already failed here environmentally before this
  change. Please run `next build` locally as the final gate.

## 7. Questions raised (answers needed before any Goal-3 work)

1. `Waveform` decodes each track with a throwaway `new AudioContext()` even
   though the player decodes the same bytes on the shared context. Dedupe?
   (Changes audio-fetch/decode patterns — not touched without your OK.)
2. Waveform bars are session-cached (`waveformBarsCache`) but recomputed every
   visit. Persist (e.g. localStorage) or keep as-is?
3. `uploadToR2Direct` has a 30-min XHR timeout and 3-upload concurrency —
   fine to leave, or worth revisiting? (Left untouched.)

## 8. Bugs noticed but NOT fixed

- **Desktop/landscape loading skeletons never show:** the page only renders
  `MobilePortraitSkeleton` (gated by `.skeleton-portrait-mobile`); the desktop
  and landscape skeletons were unreachable (see dead code). If a desktop
  loading skeleton is desired, it needs to be wired up — decide, then re-add
  deliberately (the deleted components are in git history).
- `uploadFileType` is declared at column 0 *inside* `ProjectPage`
  (mis-indented, works fine). Left as-is to keep the body byte-identical.
- Pre-existing eslint errors (42× `react-hooks/refs` /
  `set-state-in-effect` class) exist in this directory — they predate the
  refactor (verified by linting the original file) and were intentionally not
  "fixed" since those rules flag deliberate patterns here (rAF-driven refs).
- `.env.example` lists `R2_ACCOUNT_ID`, which no code reads (noted during the
  earlier AGENTS.md pass).

## 9. Chose NOT to refactor (couldn't guarantee safety)

- **Decomposing `ProjectPage` itself** (~3,450 lines of interleaved state:
  uploads, recording, merge, tours, edit sessions, layout detection). Its
  ~80 useState/useRef hooks are densely cross-referenced; splitting them into
  custom hooks would change nothing *if done perfectly*, but a mistake there
  is exactly the inaudible-regression class the prime directive forbids.
  Recommend doing this later in small, individually reviewed steps (e.g.
  upload queue first, then recording session state).
- Merging the near-duplicate `clearPreviewMixPlayback` / `switchToFullMix`
  bodies inside usePlayer (they differ by one `recomputeTransportDuration()`
  call) — left verbatim.
- The `beatsPerBar` / time-signature parsing consolidation (subtle negative-
  number difference, see §4).
