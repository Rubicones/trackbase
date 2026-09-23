# Subscription & entitlement audit — round 2

**Date:** 2026-09-21
**Scope:** `lib/plans.ts`, `lib/entitlements.ts`, `lib/planChange.ts`, `lib/planConflicts.ts`, `lib/planGuards.ts`, `lib/bandFreeze.ts`, `lib/freezeOrder.ts`, `lib/bandLimit.ts`, `lib/bandStorage.ts`, `lib/trackDedup.ts`, `lib/billing/*`, every route handler under `app/api/`, the plan/billing migrations, and the client plan surfaces.

**Not in scope:** the security audit (done separately). Findings below with a security flavour are here only because they move bytes or capacity.

**Method:** every enforcement site located by call graph. Every write-bearing route under `app/api/` enumerated and checked individually for a frozen-state guard. Every limit traced definition → read → enforcement.

**Relationship to `PLANS-AUDIT.md`:** that report's R1, R2, R4, U1, U4, U6, U10 and S2 are now fixed in the code — verified, and listed under *Verified correct*. R3, R5, R6, R7, U2, U3, U5, U7, U9, U11, N1–N9 and B1–B5 are **still open** and are restated here with current line numbers, because nothing in the repo marks them as resolved.

---

# STEP 1 — Spec-to-code matrix

## Source of truth

**Singular for the application.** `lib/plans.ts` `PLANS` is the only table of limits. `lib/entitlements.ts` `resolveEntitlements()` is the only function that computes an effective limit. Outside `lib/entitlements.ts`, `profiles.plan` and `plan_addons` are read or written by exactly two things: `POST /api/dev/plan` (dev-gated) and `lib/billing/store.ts` (Stripe reconciliation). No route handler contains a plan literal. No plan or paywall component states a limit or a price — all of it renders `planLimitRows()`, `planUpgradeHighlights()` and `lib/planCopy.ts`.

**One deliberate second copy:** `public.plan_limits` mirrors `bands_owned` for `effective_band_limit()`, the trigger/RPC backstop. Documented as a mirror, but it is a live drift surface — see **S1**.

## The matrix

| Limit | Defined | Read (resolver) | Enforced | Displayed |
|---|---|---|---|---|
| **bandsOwned** free 1 / solo 1 / band 3 / band+ 5 | `lib/plans.ts:95–125`; **mirror** `plan_limits` (`20260806_subscription_plans.sql:213`) | `entitlements.ts:302` base, `:314` `+extra_band`, `:347–351` override floor | `lib/bandLimit.ts:132` `createBandForUser()` → RPC `create_band_with_owner` (row lock on profiles). Callers: `POST /api/bands:68`, `POST /api/projects:49`. DB backstop: `effective_band_limit()` + `trg_enforce_band_owner_limit` on `band_members`. Over-limit consequence: `splitBandsForFreeze` → freeze (`bandFreeze.ts:158–171`) | `GET /api/dashboard` `bandLimit`; `GET /api/me/plan` |
| **membersPerBand** free 3 / solo 2 / band ∞ / band+ ∞ | `lib/plans.ts` `membersPerBand` | `entitlements.ts:303`, `:330` `+extra_member` (band-scoped), via `getBandEntitlements(bandId)` → **owner's** plan | `planGuards.ts:52 assertCanAddMember()` — **one call site**: `POST /api/bands/[id]/join-requests/[requestId]:84`. Legacy invite routes are `410 Gone`. Also the only blocking upgrade conflict (`planConflicts.ts:381`) | `GET /api/bands/[id]` `memberLimit` |
| **storagePerBandMB** free 500 / solo 10240 / band 10240 / band+ 51200 | `lib/plans.ts` `storagePerBandMB` | `entitlements.ts:304`, `:321` `+extra_storage` ×10 GB (band-scoped), owner's plan | `planGuards.ts:85 assertStorageHeadroom` / `:116 storageRefusal` at 8 sites: `versions/[id]/tracks/presign:73`, `.../upload:159,261`, `.../process:206,298`, `tracks/[id]/edit:165`, `tracks/[id]/midi-upload:79`, `projects/[id]/resources/process:142`; plus `lib/resource-presign.ts:84` via `resolveBandStorageLimitBytes` | `GET /api/dashboard` per band; `GET /api/bands/[id]` `storageLimitBytes` |
| **activeVersionsPerProject** free 3 / paid ∞ | `lib/plans.ts` `activeVersionsPerProject` | `entitlements.ts:358` — base only; no addon can raise it (correct, none exists) | `planGuards.ts:145 assertCanCreateVersion()` — **one call site**: `POST /api/projects/[id]/versions:64`. Counter `countActiveVersions()` = `type='branch' AND merged_at IS NULL` | `GET /api/bands/[id]` `activeVersionLimit` |
| **features** | `lib/plans.ts` `GATED_FEATURES` = `ab_compare, track_edit, chord_detect, cherry_pick`; `free.features = []`, all four on every paid plan | `entitlements.ts:359`, owner's plan | `planGuards.ts:171 assertBandFeature()` — **two call sites**: `track_edit` at `tracks/[id]/edit:91`; `cherry_pick` at `projects/[id]/merge:113`, gated on the presence of any selective field rather than on the endpoint. **`ab_compare` and `chord_detect`: nowhere** | `usePaywallGate()`; `GET /api/bands/[id]` `features` |
| **frozen band = read-only** | `bands.frozen_at` / `frozen_reason` | `bandFreeze.ts:117 ensureBandFreezeState()` | `requireBandMember*` by HTTP method (`lib/supabase/server.ts:190`) covers all 38 project/version/track/section/comment write routes; band-level routes call `frozenBandRefusal()` explicitly at 7 sites | banners |

**Limits defined but enforced nowhere:** `ab_compare`, `chord_detect` (see **S4**, **L2**, **U8**).
**Limits enforced from a hardcoded constant rather than the resolver:** none remaining. `BAND_STORAGE_LIMIT_BYTES` (1 GB) survives only as a display fallback, and one of those fallbacks is wrong — see **U9**.

---

# Findings

## Revenue leak — paid capacity given away

### L1. `PATCH /api/tracks/[id]` lets any band member erase storage usage by colliding a hash

**Where:** `app/api/tracks/[id]/route.ts:82` (allow-list includes `file_hash`); `lib/bandStorage.ts:75–80` (usage = sum of `file_size_bytes` over *first-seen* `file_hash`).

**Reproduce:** band has two 400 MB tracks, A and B, with distinct hashes; usage reads 800 MB.
`PATCH /api/tracks/{B}` with `{ "file_hash": "<A's hash>" }`. The value passes `isValidFileHash` (shape only — it is never checked against the bytes at `storage_path`). Next `getBandStorageUsed()` sees the hash once and counts 400 MB.

**Now:** 400 MB of quota freed, both objects still in R2, both tracks still playable (`storage_path` is untouched and still validated to this project). Repeat once per track.

**Should:** either `file_hash` leaves the allow-list — the two writers that legitimately change it (`tracks/[id]/midi-upload` returns the hash it computed, the edit route writes its own) could write it server-side — or the PATCH re-derives usage and re-runs `storageRefusal`. The allow-list comment at `:73–79` already reasons carefully about why `file_size_bytes` must not be writable; `file_hash` is the same value by another route, because usage is keyed on it.

**Cost per occurrence:** unbounded. A free band can hold arbitrarily many bytes against a 500 MB ceiling.

**Reachability:** any authenticated member of any non-frozen band, one request, no UI needed.

---

### L2. Two of the four gated features have no server enforcement

**Where:** `lib/planGuards.ts:171` `assertBandFeature` is called at exactly two sites (`tracks/[id]/edit:91`, `projects/[id]/merge:113`). `ab_compare` and `chord_detect` are never passed to it.

**Now:** `chord_detect` runs entirely in `public/workers/chordsWorker.js` with Essentia WASM — there is no server endpoint to gate, and `AGENTS.md` says so. `ab_compare` is `components/CompareMode.tsx`, pure client playback of two versions the user is already entitled to read. The only gate for both is `usePaywallGate()`, which reads a snapshot fetched once per `PaywallProvider` mount (`contexts/PaywallContext.tsx:242`) and is never invalidated by a plan change that happens elsewhere.

**Consequences, in order of severity:**

1. A user who downgrades (or whose subscription lapses via webhook) keeps both features in every open tab, indefinitely, until a full page load.
2. Neither feature can be withheld from anyone who can set a JavaScript variable.
3. Because the lock is client-side and resolves against the *user's* plan, a free member of a Band+ band is denied both outright with no server-side path to grant them — the inverse failure. See **U8**.

**Should:** this is a product decision, not a bug fix. Either accept that these two are marketing gates and say so in `lib/plans.ts`, or move the work server-side (`chord_detect` would need a `POST /api/versions/[id]/chords` endpoint; `ab_compare` has nothing to move).

**Cost per occurrence:** the difference between free and $6/mo for any user who wants only these two features.

---

### L3. Storage that is paid for in R2 and counted nowhere

Not a quota leak — a Cloudflare bill leak. Usage is computed from `tracks` and `project_resources` rows only (`lib/bandStorage.ts:63–96`). These objects exist in R2 and are invisible to it:

| Object | Created | Purged |
|---|---|---|
| Preview mixes | `lib/previewMix.ts:224` → `projects.preview_mix_storage_path` | never |
| Abandoned presign temp objects | `lib/r2TempKey.ts` keys, uploaded by the browser | only on a successful `process` (`process/route.ts` `deleteFromR2(tempKey)`); an abandoned upload leaks the object |
| Objects behind a deleted track | — | `DELETE /api/tracks/[id]:36` deletes the row only |
| Objects behind a deleted version | — | `DELETE /api/versions/[id]:68+` deletes rows only |
| Every object in a deleted band | — | `DELETE /api/bands/[id]:455` deletes the band row; the cascade removes `projects`/`versions`/`tracks` rows without ever reaching R2 |

`DELETE /api/projects/[id]:295–333` is the only path that purges R2, and it does it correctly: unique hashes, checked against tracks outside this project's versions, deleted only when the count is zero.

**Should:** `DELETE /api/bands/[id]` should run the project-delete purge per project before dropping the band, and track/version deletes should purge when the hash has no remaining referent. At minimum, a reaper for temp keys older than a day.

**Cost per occurrence:** the storage cost of every band ever deleted, forever.

---

### L4. `plan_limits` is a silent one-way drift surface

**Where:** `20260806_subscription_plans.sql:213–217`.

`lib/plans.ts` and `plan_limits` must agree. If `plan_limits` is *lower* than `lib/plans.ts`, the app offers a band the trigger refuses with `BL001` (user harm — this is the shape of **B2**). If `plan_limits` is *higher*, the app is stricter and nothing leaks — which is why a production `free = 3` would be invisible rather than exploitable, and also why nobody would notice it drifting back.

The `on conflict (plan) do update set bands_owned = excluded.bands_owned` on line 217 means re-running this migration silently resets any hand-edited value. See **S1**.

---

## User harm — a paying user denied, stuck, or misinformed

### U1. `enforced` is a terminal state when the remaining conflict is not a band-count conflict

**Where:** `lib/bandFreeze.ts:158–171` (freezing is driven only by `splitBandsForFreeze`, i.e. the owned-band count); `:199–202` (grace clears only when `checkPlanConflicts` returns empty).

**Reproduce:** Band+ owner, one band, 5 GB stored. Downgrade to free. `checkPlanConflicts` returns `storage_exceeded`. Grace armed for 14 days. Fourteen days pass.

**Now:** `resolvePlanState` derives `enforced`. `reconcileOwnerBands(enforce: true)` computes `split.freeze = []` (one band, limit one) — nothing is frozen. `checkPlanConflicts` still returns `storage_exceeded`, so `clearGrace` never runs. The account is permanently `enforced`. The banner announces that bands over the limit are frozen; none are. Uploads are correctly refused, so the *enforcement* is right — the *state* and the copy are wrong, and there is no exit except deleting content down under 500 MB.

Same shape for `versions_exceeded`.

**Should:** either `enforced` means "the band-count consequence has been applied" and the derivation should stop treating non-band conflicts as blockers to clearing grace, or the banner copy has to distinguish "bands frozen" from "over your storage ceiling". This changes what users see, so it is a **product decision** — flagged, not fixed.

---

### U2. Storage inside a frozen band cannot be freed, so freezing can be self-perpetuating

**Where:** `lib/supabase/server.ts:190` blocks every write method in a frozen band, including `DELETE /api/tracks/[id]` and `DELETE /api/versions/[id]`.

**Reproduce:** `band` plan, 2 owned bands. Downgrade to free. Grace expires. Band B freezes. Band B is also over free's 500 MB.

**Now:** the user deletes band A to get back under the band limit. Reconciliation unfreezes B. But while B *was* frozen there was no way to delete a track in it, and `checkPlanConflicts` counted B's `storage_exceeded` the whole time — so grace could never clear and B could never leave `enforced` on its own. The only action available inside a frozen band that reduces anything is deleting the entire band.

**Should:** deleting a track or a version is the frozen-band analogue of deleting the band — it reduces what the plan is being asked to cover and destroys nothing the user wants kept. Either allow those two deletes in a frozen band (same reasoning as the deliberate member-removal exception), or say plainly in the frozen banner that the only route back is deleting the space.

---

### U3. A deleted band destroys the add-on the user is still being billed for

**Where:** `plan_addons.band_id uuid references public.bands(id) on delete cascade` (`20260806_subscription_plans.sql`, `plan_addons` DDL).

**Reproduce:** buy `extra_storage` scoped to band X (`POST /api/billing/addons`, Stripe subscription item created with `metadata.band_id = X`). Delete band X.

**Now:** the FK cascade removes the `plan_addons` row. The Stripe subscription item is untouched and keeps billing $4/month. On the next webhook, `resolveAddonBand` → `ownedBandId` returns null for the dead band, so `syncAddonsFromSubscription:426` `continue`s — the item is never added to `seen`, but the row it would have matched is already gone, so the stale sweep has nothing to do either. The charge is permanent and invisible from inside the app.

**Should:** when a band is deleted, either re-scope its band-scoped add-on items to another owned band or remove the subscription items from Stripe. Which of those is right is a **product decision**; that the current behaviour is billing for nothing is not.

---

### U4. Add-ons that a plan cannot use are sold anyway

**Where:** `app/api/billing/addons/route.ts:69–90` validates the addon type and band ownership, and nothing else. `lib/entitlements.ts:331` — `addToLimit(null, n)` returns `null`.

**Reproduce:** on `band` or `band_plus` (both `membersPerBand: null`), buy `extra_member`.

**Now:** the Stripe subscription item is created, the card is charged $2/month, the `plan_addons` row is written, and `resolveEntitlements` adds it to an already-unlimited ceiling, which is a no-op. The user sees the addon listed in `GET /api/me/plan` `addons` and no change to any limit.

**Should:** refuse the purchase with a 409 when `PLANS[plan]` already grants `null` for that dimension. Two lines in the addons route.

---

### U5. Add-on cleanup is scoped by user, not by subscription

**Where:** `lib/billing/store.ts:445–457`. The stale sweep selects *every* `plan_addons` row for the user with a non-null `stripe_subscription_item_id`, and deletes any whose item id is not in `seen` — where `seen` was built from one subscription's items.

**Reproduce:** a user holds two live subscriptions (possible: a second checkout stuck on 3DS leaves an `incomplete` row; a resubscribe before the old `deleted` lands). Add-ons exist on both. Any webhook for subscription A runs the sweep and deletes subscription B's add-on rows.

**Now:** capacity the user is being billed for disappears. It comes back only when a webhook for B arrives.

**Should:** scope the sweep to the subscription being synced — the rows carry `stripe_subscription_item_id`, so joining through the subscription is possible; or select only rows whose item belongs to `sub.id`.

---

### U6. A free member inside a paid band is denied the two unenforced features outright

**Where:** `contexts/PaywallContext.tsx:176–182` resolves `locked` against the *user's* plan unless a `bandFeatures` argument is passed. **No call site passes one:** `TrackRow.tsx:210`, `MergeModal.tsx:524`, `project/[projectId]/page.tsx:241`, `StructureEditor.tsx:385`.

**Now:** a free user in a Band+ owner's band sees all four features locked. For `track_edit` and `cherry_pick` this is cosmetic — the server would allow them, the button is simply hidden. For `ab_compare` and `chord_detect` the UI lock *is* the only gate (see **L2**), so those two are genuinely denied to every free member of every paid band. That is the exact case the "pay for a band, not a seat" model exists to serve.

**Should:** pass `bandFeatures` at all four sites. `GET /api/bands/[id]:350` already returns `features`, so the data is present on the band page and the mixer.

---

### U7. A sole owner cannot leave, and the refusal points at a feature that does not exist

**Where:** `lib/bandAccess.ts:71` `LAST_OWNER_REFUSAL` — "leave once it has another owner". No route in the app writes `band_members.role`; the file's own comment at `:55–70` says so.

**Now:** the only way out of a band you solely own is deleting it, taking every other member's work with it. The copy sends people looking for a transfer screen.

**Should:** build ownership transfer (see **Needs a product decision**) or change the copy to name the two real options.

---

### U8. Deleting an account deletes other people's bands without warning

**Where:** `app/api/profile/account/route.ts:83–101`.

**Reproduce:** own a band with four other members. Delete your account.

**Now:** `count` of owner rows is 1, so `supabase.from('bands').delete()` runs and the FK cascade removes every project, version, track, comment and message. The other four members lose everything, with no notice, no export and no undo. The confirmation dialog asks for a username and says nothing about it.

**Should:** at minimum the confirmation must name the bands and their member counts. Better: refuse to delete a band with other members until ownership is transferred (which does not exist — **U7**) or the members are gone.

---

### U9. `GET /api/bands/[id]` reports 1 GB when storage is unlimited

**Where:** `app/api/bands/[id]/route.ts:347` — `mbToBytes(entitlements.storagePerBandMB) ?? bandStorageLimitBytes()`.

`mbToBytes(null)` returns `null` for "unlimited", and `??` then substitutes the legacy 1 GB constant, whose own docblock (`lib/bandStorage.ts:246–249`) says not to use it as a value. Dormant today — no plan defines unlimited storage — and it becomes a 98% understatement the day one does.

**Should:** `?? null`, and let the client render "Unlimited".

---

### U10. The post-checkout UI refreshes once, on a timer, and may miss the webhook

**Where:** `app/billing/BillingClient.tsx:~79–88` — one `void refresh()` after a 2,500 ms delay on `?checkout=success`.

**Now:** if Stripe's `checkout.session.completed` has not landed and been processed within 2.5 s, the user returns from a successful payment to a page still showing `free`, with no further refresh and no indication anything is pending.

**Should:** poll a few times with backoff, or render an explicit "confirming your payment" state until `plan` changes.

---

## Spec divergence

### S1. `plan_limits.free.bands_owned` is seeded at **1** in this repo, not 3

**Where:** `20260806_subscription_plans.sql:213–217`.

Your brief states the production value is 3 as a temporary beta setting, and that the migration was a no-op on production. Two problems:

1. **The repo does not contain that setting.** The migration seeds `('free', 1)` with `on conflict … do update set bands_owned = excluded.bands_owned` — an upsert that overwrites, so re-running it resets a hand-set 3 to 1 without comment.
2. **The setting is inert regardless.** `lib/plans.ts:95` `free.bandsOwned = 1` is what the application enforces at `createBandForUser()`, and the application refuses before the DB trigger is ever consulted. `plan_limits` is only a backstop, and a backstop that is *looser* than the app never fires. A free beta account is capped at one owned band today whatever `plan_limits` says.

**Which is correct:** the code. If the intent is that beta free accounts get three bands, `lib/plans.ts` is the file that has to say so — and then `plan_limits` has to be raised to match, or the trigger refuses what the app allows.

**Verify on the live database:** `select * from public.plan_limits order by bands_owned;`

---

### S2. `profiles.band_limit` is not the override column, and the override is a floor, not a replacement

Your brief describes a nullable `profiles.band_limit` that REPLACES the plan allowance. The code:

- The plan system reads **`profiles.band_limit_override`** (`entitlements.ts:196`, `:223`, `:347`). `profiles.band_limit` is the pre-plans column, `NOT NULL DEFAULT 3`, read by nothing in the plan system and deliberately preserved for a rollback (`20260806_subscription_plans.sql:60–76`).
- The semantics changed **today**, 2026-09-21, from replacement to `greatest(override, plan_base + extra_band)` — `entitlements.ts:337–351` and `20260921_band_limit_override_floor.sql`.

**Which is correct:** the floor. The migration's own reasoning is sound — under replacement, a grandfathered account on override 3 that bought Band+ resolved to 3, and any `extra_band` they bought granted nothing at any quantity. Both are revenue-negative in the direction that matters.

**But:** `AGENTS.md` still describes replacement in §4 ("`profiles.band_limit`, which when non-null **REPLACES** the computed owned-bands limit outright"), and `lib/bandLimit.ts:8–9` still says "it means *ignore the plan for this account*". Three descriptions, two of them now wrong. And see **B2** — if the paired migration has not been applied, the app and the database disagree today.

---

### S3. `AGENTS.md` §1 says there is no Stripe; §4 documents the whole implementation

`AGENTS.md:31` — "There is currently **no billing** — no Stripe, no checkout, no webhooks". `AGENTS.md` §4 "Billing (Stripe)" then describes `POST /api/stripe/webhook`, `POST /api/billing/checkout`, `POST /api/billing/portal`, `POST /api/billing/addons`, `GET /api/me/billing`, `lib/billing/*`, `BILLING_LIVE` and three migrations — all of which exist in the repo and all of which I read.

**Which is correct:** §4. §1 is stale and is the sentence someone will read first. The audit brief inherited it ("before Stripe is wired in"): Stripe *is* wired in; what is missing is the keys (`BILLING_LIVE` is false without both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`) and two manual migrations.

---

### S4. `ab_compare` and `chord_detect` are defined as gated and enforced nowhere

Covered in **L2**. Listed here too because by your own criterion — "a limit defined but enforced nowhere is a finding" — it is one. `lib/plans.ts` presents four gated features as a homogeneous set; two of them are structurally unenforceable.

---

### S5. `hasStructuralConflicts()` is dead code and does not do what its name says

**Where:** `lib/planConflicts.ts:323` — `return conflicts.length > 0`. It draws no distinction between structural and non-structural conflicts, and no caller exists anywhere in the repo. Delete it, or implement the distinction **U1** needs.

---

### S6. `resolvePlanState`'s docblock overstates the derivation

**Where:** `lib/entitlements.ts:588–597` — "Resolve the account state from `profiles.plan`, `grace_until` **and the actual data**".

The function reads only `grace_until`. It never looks at the data. `settleAccount()` is what makes the data part true, and it runs at three endpoints (`GET /api/me/plan:65`, `GET /api/dashboard:103`, `POST /api/dev/plan` ×4). Everywhere else, `resolvePlanState` is a timestamp comparison. That is a defensible design, but the docblock describes a different function, and **B4** is a direct consequence.

---

## Undefined behaviour

### N1. Two owners break every band-scoped entitlement read

**Where:** `lib/entitlements.ts:395–404` — `getBandOwnerId` selects `band_members` where `role = 'owner'` with `.maybeSingle()`.

PostgREST returns an error (`PGRST116`) when `maybeSingle()` matches more than one row, and the function rethrows it. So a band with two owner rows makes `getBandEntitlements` throw, which takes down `assertCanAddMember`, `assertBandFeature`, `assertCanCreateVersion`, `getBandStorageQuota`, `ensureBandFreezeState` and every route that calls them — a 500 on every write to that band and on opening it.

**Currently unreachable through the app:** no route writes `band_members.role`. But `countBandOwners()` and `LAST_OWNER_REFUSAL` both exist specifically to handle the multi-owner case, the schema permits it, and any future transfer feature creates it. Both bands' owners would also each count the band toward their own `countOwnedBands()`.

**Should:** `getBandOwnerId` should order deterministically and take the first row, or the schema should carry a partial unique index making one owner per band an invariant. The second is the honest fix and would make `countBandOwners` dead code.

---

### N2. An ownerless band is fail-closed for limits and permanently unfreezable

**Where:** `entitlements.ts:419–431` falls back to the free plan when there is no owner ✔ (matches spec — fail closed). But `bandFreeze.ts:120–122` returns the *current* state and does nothing when `ownerId` is null.

**Now:** an ownerless band can never be frozen, and if it is already frozen it can never be unfrozen. Unreachable today because last-owner removal is refused in both routes (`members/me:28`, `members/[userId]:83`) — but those are read-then-write with no transaction, and account deletion is the one path that removes an owner unconditionally (it deletes the band instead, **U8**).

---

### N3. A join request can be filed against a frozen band and can never be approved

**Where:** `POST /api/bands/join` (`app/api/bands/join/route.ts:10`) has no frozen check. `POST /api/bands/[id]/join-requests/[requestId]:81` refuses approval while the band is frozen.

**Now:** the request is created, the owner gets a push notification, and approving it returns `band_frozen`. The requester sees "pending" on their dashboard forever with no explanation. Neither side is told why.

**Should:** refuse the join request at submission with a clear reason, or tell the owner why approval is blocked. The current behaviour is a silent dead end for two people.

---

### N4. `claimEvent` silently disables duplicate protection when the table is missing

**Where:** `lib/billing/store.ts:479–491` — any insert error other than `23505` logs a warning and returns `true`, i.e. "this event is fresh, handle it".

The billing migrations are applied by hand. If `billing_events` does not exist, every delivery of every event is treated as fresh, and the only protection left is whatever idempotency each handler has on its own. `changePlan` is safe on a repeat (direction `none`), but `syncAddonsFromSubscription` upserts on `stripe_subscription_item_id` — which is exactly the constraint that **B1** says does not currently work.

**Should:** distinguish "table missing" (fail loudly at startup, or refuse the webhook) from "database unhappy" (let the handler run and let Stripe retry).

---

### N5. The webhook applies the plan before the add-ons, and nothing re-settles

**Where:** `app/api/stripe/webhook/route.ts:169–170`.

`changePlan` runs `checkPlanConflicts` against the add-on rows as they are *before* the purchase, then `syncAddonsFromSubscription` writes the new ones. A first checkout of Band+ plus two `extra_band` add-ons therefore evaluates conflicts against 5 bands, not 7 — and if the user owns 6, a 14-day grace period is armed over a conflict the add-ons resolve one line later. Nothing reconciles afterwards.

It self-heals: the next `GET /api/me/plan` or `GET /api/dashboard` calls `settleAccount`, which finds no conflicts and clears the deadline. But between the webhook and that read the account is in `grace` for no reason, and `reconcileOwnerBands` has already run with the wrong inputs.

**Should:** `await settleAccount(userId)` after `syncAddonsFromSubscription`. One line.

---

### N6. Nothing settles after a band is deleted

**Where:** `DELETE /api/bands/[id]:441–461`.

Deleting a band is the documented way out of `too_many_bands`, and it changes the answer to every conflict check — but the route does not call `settleAccount` or `reconcileOwnerBands`. The account stays in `grace`/`enforced` and any remaining frozen band stays frozen until some other request happens to settle. The dashboard does settle, and that is where the user lands, so this is usually invisible — but it is invisible by luck, not by design.

---

### N7. The resolver silently ignores mis-scoped add-on rows

**Where:** `entitlements.ts:310–334`. An `extra_band` row with a `band_id` has its `band_id` ignored (documented). An `extra_storage` or `extra_member` row with a null `band_id` is dropped entirely, granting nothing.

The `plan_addons_scope_check` CHECK constraint makes both unreachable from the database, so this is defence in depth rather than a bug. But the second case is a silent, permanent loss of paid capacity if the constraint is ever relaxed, and nothing logs it.

---

### N8. `POST /api/dev/plan` `grant_addon` can produce a raw 500

**Where:** `app/api/dev/plan/route.ts:137–155`. It accepts `band_id` for `extra_band` (only `extra_storage`/`extra_member` are checked for a *missing* band), which the CHECK constraint rejects, producing `500 { error: "<raw postgres error>" }`. Dev-only, cosmetic, but it is the tool people will use to reproduce these findings.

---

### N9. `readLiveSubscription` reads a database outage as "never subscribed"

**Where:** `lib/billing/store.ts:150` — `if (error) return null`.

Deliberate, so that a missing billing table does not take a page down. The cost is that a transient error makes `POST /api/billing/addons` answer `no_subscription` to a paying customer, and makes `POST /api/billing/checkout` send an existing subscriber to Checkout instead of the portal — producing a second subscription. That second subscription is the precondition for **U5**.

---

## Stripe blockers

### B1. `syncAddonsFromSubscription` cannot execute until a manual migration runs

**Where:** `20260920_billing_stripe.sql` created a *partial* unique index on `plan_addons.stripe_subscription_item_id`; `lib/billing/store.ts:439` upserts with `onConflict: 'stripe_subscription_item_id'`, which PostgREST compiles to a bare column list that Postgres will not match to a partial index. Every call raises `42P10`.

Both callers run *after* the Stripe item exists, so the user is billed and the `plan_addons` row is never written. The fix exists — `20260921_plan_addons_unique_stripe_item.sql` — and is manual.

**Blocker until confirmed applied.** Verify: `select conname, contype from pg_constraint where conrelid = 'public.plan_addons'::regclass;` — expect a plain `u` constraint on the column.

---

### B2. The override rule may be implemented differently in the app and the database right now

**Where:** `lib/entitlements.ts:347–351` (floor, shipped) vs `effective_band_limit()` (replacement, until `20260921_band_limit_override_floor.sql` is applied — also manual).

While they disagree, a grandfathered account whose plan grants more than its override is offered a band by the UI and the app-level check, and refused by the trigger with `BL001` → `band_limit_reached`. The user is told they have hit a limit the same screen just told them they were under.

**Blocker until confirmed applied.** Verify: `select public.effective_band_limit(p.id), p.band_limit_override, p.plan from public.profiles p where p.band_limit_override is not null;`

---

### B3. Entitlement state cannot be reconstructed from `profiles.plan` + `plan_addons`

This is the one that fails your Step 6 criterion directly.

**Limits** reconstruct cleanly: `resolveEntitlements` is a pure function of `profiles.plan`, `plan_addons` and `band_limit_override`. ✔

**State does not.** `grace_until`, `grace_keep_band_ids` and `bands.frozen_at` are history, not current values, and they are written only by the transition that created them (`changePlan:164–166`, `startGrace`, `setFrozen`). A reconciliation that replays *current* Stripe values through `changePlan` will:

- compute `direction` from the plan the profile currently holds, which after a reconciliation is already the target → `direction === 'none'` → the existing deadline is carried forward, expired or not (`planChange.ts:158–162`);
- or, if the profile was out of sync, compute a `downgrade`/`upgrade` and **arm a fresh 14 days** over a grace period the user has already served.

So replaying a subscription that has been on `band` for six months, against a profile that drifted to `free`, hands the user a brand-new grace period and unfreezes bands that were correctly frozen. There is no idempotency key for "this grace period", and no record of when the transition that armed it happened beyond the deadline itself.

**Should:** store what the grace period is *for* — the plan it was armed against and the timestamp it was armed at — so a reconciliation can recognise a period it has already applied. Alternatively, make reconciliation a distinct entry point from `changePlan` that never arms grace, and let `settleAccount` be the only thing that starts a clock.

---

### B4. `changePlan()` is not atomic

**Where:** `lib/planChange.ts:168–176` — one `update` on `profiles`, then `reconcileOwnerBands()`, with no transaction.

The dangerous half is bounded: a downgrade that leaves conflicts always arms grace, so nothing is due to freeze at that moment, and a failure after the plan write leaves the user on the new plan with nothing frozen — correct. The other direction is worse in appearance and self-heals: an upgrade out of `enforced` writes the plan, and if `reconcileOwnerBands` throws, the bands the user just paid to unfreeze stay frozen until they open one (`ensureBandFreezeState:127` takes the slow path for an already-frozen band and releases it). Note that `settleAccount` will *not* rescue this case — with `grace_until` now null and the band count within limit it returns at `:265` without reconciling.

For a webhook this matters more than for the dev switcher: Stripe's retry re-runs `applySubscription`, which is fine, but the claim in `billing_events` was already released on the throw, so the retry is a second full pass.

**Should:** move the plan write and the reconciliation into one RPC, or make the webhook's failure path explicit rather than relying on a later band open.

---

### B5. Webhook user resolution falls back to dashboard-editable metadata

**Where:** `app/api/stripe/webhook/route.ts:82–93` — `resolveUserId` tries `billing_customers` first ✔, then falls back to `sub.metadata.supabase_user_id`.

Subscription metadata is editable by anyone with Stripe dashboard access. A typo or a compromised dashboard session grants a plan to an arbitrary user id, and the fallback fires precisely when the customer is *unknown* to us — i.e. when there is no independent check available. The plan itself is correctly resolved from the Price id, so the exposure is "which account gets it", not "what they get".

**Should:** treat an unknown customer as unresolvable and log it, or accept the metadata only when the customer id in the event also has `metadata.supabase_user_id` matching. The current comment ("belongs to another environment sharing the same Stripe account") describes the case where returning early is already correct.

---

### B6. `changePlan()` **is** idempotent for the cases you asked about

Stated here because it is a blocker candidate that cleared:

- **Called twice with the same target:** the second call has `direction === 'none'`. `armsFreshGrace` is false, so no second grace period, no reset deadline, and `grace_keep_band_ids` is preserved (`planChange.ts:155–166`). It re-writes the same `plan` value and re-runs `reconcileOwnerBands`, both of which converge. ✔
- **"Changing" to the plan the user is already on:** same path. Deliberately falls through rather than short-circuiting, so the deadline and the frozen set are re-evaluated against current data — which is what the UI needs after a conflict is resolved. ✔
- **Duplicate webhook delivery:** caught earlier by `claimEvent` (subject to **N4**), and harmless if it gets through. ✔

The exclusion of `direction === 'none'` from `armsFreshGrace` is the single line that makes this true, and the comment at `:140–149` explains why. It is load-bearing — do not "simplify" it.

---

# Verified correct

Scenarios walked end to end, with the result:

**Enforcement resolution**
- Every member, storage, version and feature check resolves from `getBandEntitlements(bandId)` → band **owner's** plan. Verified at all 12 call sites individually, not assumed from the helper. A free user inside a Band+ owner's band is unrestricted server-side for members, storage, versions, `track_edit` and `cherry_pick`. (`ab_compare`/`chord_detect` are the exception — **U6**.)
- Band creation is the one per-*user* limit and correctly uses `getEffectiveEntitlements(userId)`.
- No hardcoded plan number anywhere outside `lib/plans.ts` and `plan_limits`. Grepped `components/plan`, `components/paywall`, `app/billing`, `lib/planCopy.ts` — clean.

**Downgrade immediacy**
- Features lock on the next request: `assertBandFeature` reads the database every time, no cache, no session state. `POST /api/tracks/[id]/edit` and selective `POST /api/projects/[id]/merge` refuse immediately after a downgrade.
- Storage and version ceilings likewise — every guard re-reads. No cache expiry anywhere on the server path.
- The client snapshot *is* stale until reload (`PaywallContext.tsx:242`), which matters only for the two unenforced features.

**Grace expiry**
- `grace_until` is evaluated on read (`resolvePlanState:598–627`) and compares correctly against an arbitrarily old timestamp — `Date.parse` → `deadline > now` → `enforced`, with `graceDaysLeft` clamped to 0. A user who disappears for six months returns to `enforced` on their first request, and `settleAccount` runs at both endpoints that render a banner.
- A malformed `grace_until` degrades to `active` rather than throwing (`:612`).

**Frozen bands**
- All 38 project/version/track/section/comment write routes inherit the block from `requireBandMember*` by HTTP method. Enumerated individually. The four band-level routes that authenticate by hand (`messages`, `invite-code`, `members/[userId]` PATCH, `bands/[id]` PATCH, `bands/[id]/projects`, `projects/[id]/resources/*`, `versions/[id]/structure/submit`) each call `frozenBandRefusal()` explicitly. No route was found writing to a band without one of the two.
- The `readOnlyRequest: true` escape hatch is used at exactly two places — merge preview and preview-mix recompute — both genuinely reads.
- `DELETE /api/bands/[id]` is correctly *not* blocked. `DELETE .../members/[userId]` is correctly not blocked while its PATCH sibling is.
- Legacy invite routes (`bands/[id]/invites`, `bands/[id]/invites/current`, `invites/[token]/accept`) are `410 Gone` and cannot add a member, so `assertCanAddMember` having one call site is complete, not a gap.

**Storage accounting**
- Usage sums **unique** stored objects: `getBandStorageUsed` deduplicates by `file_hash` (`bandStorage.ts:75–80`). A file referenced by track rows in five versions is counted once. Branch creation is a pointer copy that reuses `file_hash` and `storage_path` (`projects/[id]/versions:76`), so branching a project costs the band nothing — which is the right answer and matches what a user would expect.
- Dedup on upload is **band-scoped** (`lib/trackDedup.ts`), so the quota hole where any file already present anywhere could be added to any band is closed. Verified at both upload paths.
- Byte counts are always written from the buffer the server hashed, never from a client-declared size — including the dedup-hit branch, which inherits the stored count rather than trusting `fileSize` (`process:276–280`).
- `file_size_bytes` is not in the `PATCH /api/tracks/[id]` allow-list, so it cannot be driven negative. (`file_hash` is — **L1**.)
- Deleting a track frees the quota immediately: usage is derived from rows, and the row is gone.
- Storage is never pooled. No account-wide total exists. `accountStorageLimitBytes` in the dashboard is a per-band display fallback and is documented as such.

**Freeze ordering**
- `splitBandsForFreeze` honours the user's explicit keep-choice first, in their order, then fills from most recently active, then marks the rest least-recently-active-first. Pure, shared by the preview and the enforcement, so the user cannot be shown one outcome and given another.
- "Recently active" is computed from the most recent `band_activity` row, falling back to `bands.created_at` only when a band has no activity (`entitlements.ts:541`) — not from `created_at` generally. Your concern here does not apply.
- Stale, duplicate, no-longer-owned and over-long `grace_keep_band_ids` are all tolerated and trimmed at apply time (`freezeOrder.ts:405–412`).

**Nothing is deleted by a plan change**
- Confirmed by enumeration: `changePlan`, `reconcileOwnerBands`, `setFrozen`, `clearFrozen`, `startGrace`, `clearGrace` and `settleAccount` contain no `delete` of user content. The only `delete` calls in the plan layer are `plan_addons` rows (`dev/plan`, `syncAddonsFromSubscription`) and the band-creation rollback in the pre-migration fallback.
- Downloads keep working in a frozen band: `GET /api/tracks/[id]/download` and `/stream` are reads, and reads pay no freeze check at all.
- **Members are never removed automatically.** No sequence produces it. `too_many_members` blocks an upgrade and blocks adding; nothing anywhere removes a row on a plan change, a grace expiry or a freeze.

**Counting**
- "Active version" = `type = 'branch' AND merged_at IS NULL`. Master excluded, applied branches excluded. Matches spec exactly.
- Pending join requests do **not** count toward the member limit — `countBandMembers` counts `band_members` rows only. Whether that is correct is a product question (see below), but it is consistent between the guard and the conflict checker.

**Revocation arms a clock**
- Revoking an `extra_band` while the capacity is in use does not immediately freeze anything, and it does not go unnoticed either: `settleAccount:261–269` detects "over the owned-band limit with no clock running" and starts a fresh 14 days. `dev/plan` calls `settleAccount` after every addon mutation. Lowering `band_limit_override` takes the same path. This was the gap the `settleAccount` second half was written for, and it holds.

**Unfreeze re-checks limits**
- There is no manual unfreeze route. The only path is `reconcileOwnerBands`, which recomputes the split from current entitlements every time. A user cannot unfreeze a band and stay over their limit.

**Dev switcher containment**
- Three independent gates on the same constant: `components/plan/DevPlanSwitcher.tsx:141` (returns null), `app/api/dev/plan/route.ts:69,90` (404), `app/api/me/plan/route.ts:136` (404). `DEV_PLAN_TOOLS_AVAILABLE` is `process.env.NODE_ENV === 'development'` (`lib/devPlanTools.ts:17`), and `next build` sets production for every deployment including Vercel previews. The UI gate and the two API gates were checked separately, as asked; none depends on the others. `POST /api/me/plan` is not reachable in any deployed build.
- `POST /api/billing/checkout` cannot grant a plan — it creates a Checkout Session and nothing else. The only writer of `profiles.plan` outside the dev gate is the webhook.

**Webhook seam**
- Signature verified before the body is parsed; the raw body is read with `req.text()` and never logged on failure.
- The plan is resolved from the Price id, never from metadata (`store.ts:245–249`).
- Superseded-subscription events are recognised and skipped rather than downgrading a paying account (`webhook:152–160`).
- `past_due` still entitles (`store.ts:49`) — an expired card does not look like data loss.
- `lib/entitlements.ts`, `lib/plans.ts` and `lib/planGuards.ts` contain the string "stripe" zero times. Verified by grep. The seam holds.
- Nothing in the entitlement layer requires a user session: `changePlan(userId, …)` takes the id as an argument and reads identity from nowhere. Every guard takes ids. A webhook with no session drives the whole system identically. ✔ (Your Step-6 questions about session dependence: none found.)

**Known-deliberate items, verified as described**
- Removing a member from a frozen band is allowed; the PATCH on the same route is blocked. Intentional asymmetry, present in the code.
- Band creation is protected by `SELECT … FOR UPDATE` on the profiles row inside `effective_band_limit()`, in both the RPC and the trigger. Member, version and storage checks are read-then-write with no lock. Your TOCTOU description is still accurate — not fixed, as instructed.
- `profiles.band_limit_override` is nullable and separate from `profiles.band_limit`; the two code paths cannot collide.

---

# Could not verify — needs the live database or manual testing

| # | Question | How to answer |
|---|---|---|
| 1 | Is `plan_limits.free.bands_owned` 1 or 3 in production? (**S1**) | `select * from public.plan_limits order by bands_owned;` |
| 2 | Has `20260921_plan_addons_unique_stripe_item.sql` been applied? (**B1**) | `select conname, contype, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.plan_addons'::regclass;` — expect a plain UNIQUE on `stripe_subscription_item_id` |
| 3 | Has `20260921_band_limit_override_floor.sql` been applied? (**B2**) | `select prosrc from pg_proc where proname = 'effective_band_limit';` — look for `greatest(v_override, v_computed)` |
| 4 | Has `20260807_plans_db_enforcement.sql` been applied at all? | `select prosrc from pg_proc where proname in ('effective_band_limit','create_band_with_owner','enforce_band_owner_limit');` — if `effective_band_limit` is absent, the DB backstop is still the flat pre-plans cap of 3 and Band+ users are capped at 3 by the trigger |
| 5 | Which accounts carry `band_limit_override`, and would the floor change any of them? | The verification query in `20260921_band_limit_override_floor.sql` §0 |
| 6 | Are there any bands with two owner rows? (**N1**) | `select band_id, count(*) from band_members where role='owner' group by band_id having count(*) > 1;` |
| 7 | Are there any ownerless bands? (**N2**) | `select b.id from bands b left join band_members m on m.band_id=b.id and m.role='owner' where m.user_id is null;` |
| 8 | Do any tracks share a `file_hash` with different `file_size_bytes`? (evidence of **L1** in the wild) | `select file_hash, count(distinct file_size_bytes) from tracks where file_hash is not null group by file_hash having count(distinct file_size_bytes) > 1;` |
| 9 | Does `billing_events` exist? (**N4**) | `select to_regclass('public.billing_events');` |
| 10 | How much R2 is orphaned? (**L3**) | Needs an R2 listing diffed against `tracks.storage_path` ∪ `projects.preview_mix_storage_path` ∪ `project_resources` |
| 11 | **L1 end to end** | Two tracks with distinct hashes in one band; `PATCH` one to the other's hash; re-read `GET /api/me/plan` `usage.bands[].storageBytes` |
| 12 | **U1 end to end** | Dev switcher: Band+ → upload 5 GB → downgrade to free → `POST /api/dev/plan {action:'expire_grace'}` → `GET /api/me/plan`. Expect `state: 'enforced'`, no frozen band, and a banner claiming otherwise |
| 13 | **U2 end to end** | Two bands on `band`, downgrade to free, expire grace, then attempt `DELETE /api/tracks/[id]` inside the frozen band. Expect 403 `band_frozen` |
| 14 | Stripe flows (**U3**, **U4**, **U5**, **U10**, **B1**, **B5**) | All require live Stripe test keys; none can be exercised while `BILLING_LIVE` is false |

---

# Needs a product decision

These are judgement calls. I have described the behaviour and not chosen.

1. **`ab_compare` and `chord_detect` (L2, S4, U6).** They cannot be enforced where they currently run. Three options: accept them as marketing gates and document it; move the work server-side; or ungate them and let `track_edit` + `cherry_pick` carry the paid tier. Whichever you pick, `lib/plans.ts` should stop presenting four features as one homogeneous set.

2. **What `enforced` means when the conflict is not a band count (U1).** Should storage/version conflicts hold an account in `enforced` forever, or should `enforced` mean only "the band-count consequence has been applied" and clear once the freeze is done? The second reads better and weakens the pressure to fix storage.

3. **Should deleting a track or a version be allowed in a frozen band (U2)?** The same argument that allows deleting the band and removing a member applies — it reduces what the plan must cover and destroys nothing the user wants kept. But it is a write in a read-only band, and the freeze rule's value is that it has no exceptions to remember.

4. **Ownership transfer (U7, N1).** Not implemented, and the refusal copy implies it exists. Building it means deciding whether two owners may coexist during a transfer — which is what **N1** would turn into a live 500.

5. **Account deletion with other members present (U8).** Refuse until transferred? Delete anyway with an explicit warning naming the bands? Orphan the band and let the members carry on? The third needs **N2** fixed first.

6. **Do pending join requests count toward the member limit?** They do not today. Counting them would stop an owner filling a band with approvals they cannot honour; not counting them means a full band silently accumulates requests that can never be approved (and see **N3**). Consistent either way, but it should be a decision rather than an accident.

7. **Add-ons on a band the user later deletes (U3).** Re-scope, refund, or refuse to delete a band with an add-on attached.

8. **Whether `plan_limits` should exist at all.** It is a second source of truth for one number, kept in sync by discipline. The alternative — the trigger calls out to nothing and the app is the only enforcement — loses the race protection that `SELECT … FOR UPDATE` inside `effective_band_limit()` currently provides. Worth a deliberate answer rather than inheriting the current one.

---

# Summary

**Fix now, unambiguous, code contradicts spec:**
- **L1** — drop `file_hash` from the `PATCH /api/tracks/[id]` allow-list.
- **U4** — refuse add-ons a plan cannot use.
- **U5** — scope the add-on stale sweep to the subscription being synced.
- **U6** — pass `bandFeatures` at the four `usePaywallGate` call sites.
- **U9** — `?? null` instead of `?? bandStorageLimitBytes()`.
- **N5** — `settleAccount` after `syncAddonsFromSubscription` in the webhook.
- **N6** — settle after `DELETE /api/bands/[id]`.
- **S5** — delete `hasStructuralConflicts`.
- **S2/S3** — correct `AGENTS.md`: the override column name, the floor semantics, and the "no billing" sentence in §1.

**Blocking Stripe:**
- **B1**, **B2** — two manual migrations, unconfirmed.
- **B3** — grace state is not reconstructible from current values; reconciliation will re-arm served grace periods.
- **B4** — `changePlan` is two statements, not one.
- **B5** — metadata fallback in webhook user resolution.

**Stop and decide:** **L2**, **U1**, **U2**, **U3**, **U7**, **U8**, plus **S1** — which needs the production value of `plan_limits.free.bands_owned` before anything else can be said about beta accounts.
