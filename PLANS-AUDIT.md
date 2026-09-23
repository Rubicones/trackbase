# Subscription & entitlement audit — correctness and revenue integrity

**Scope:** `lib/plans.ts`, `lib/entitlements.ts`, `lib/planChange.ts`, `lib/planConflicts.ts`,
`lib/planGuards.ts`, `lib/bandFreeze.ts`, `lib/freezeOrder.ts`, `lib/bandLimit.ts`,
`lib/bandStorage.ts`, `lib/billing/*`, all 82 route handlers under `app/api/`, and the
seven plan/billing migrations.

**Not in scope:** the security audit (done separately, findings fixed). Where a finding
below has a security flavour it is included only because it moves bytes or capacity.

**Method:** every enforcement site was located by call-graph, not by assumption. Every
band-scoped write route was enumerated and checked individually for a frozen-state guard.
Every limit was traced definition → read → enforcement.

---

## Revenue leak — paid capacity given away

### R1. `PUT /api/tracks/[id]/midi-upload` has no quota check, no size cap, and no content check

`app/api/tracks/[id]/midi-upload/route.ts:39–58`

```
const buffer = Buffer.from(await file.arrayBuffer())
const hash = createHash('sha256').update(buffer).digest('hex')
const storagePath = r2MidiKey(version.project_id, hash)
await uploadToR2(storagePath, buffer, 'audio/midi')
```

There is no `storageRefusal`, no `MAX_FILE_SIZE`, and no MIME or magic-byte validation.
It is the only upload route in the codebase without a quota call — `presign`, `process`,
`upload`, `tracks/edit` and `resources/process` all have one.

**Reproduce:** as any member of any band, on any plan, `PUT` a 200 MB file as `file` in
a multipart body to a MIDI track you own. Repeat. Each distinct byte-stream hashes
differently and lands as a new R2 object.

**What happens now:** unbounded R2 consumption. The track row's `file_size_bytes` is never
updated either (it is excluded from `PATCH /api/tracks/[id]`'s allow-list,
`app/api/tracks/[id]/route.ts:81`), so the band's measured usage does not move at all.
Storage is written, charged to nobody, and invisible to every usage surface.

**What should happen:** `storageRefusal(project.band_id, buffer.byteLength)` before the
upload, a size cap consistent with the other paths (200 MB), and the byte count written
back to the track row by this route — it produced the bytes, so per the rule in
`app/api/tracks/[id]/route.ts:74–80` it is the route allowed to record them.

**Cost per occurrence:** unbounded. This is the largest single leak found.

---

### R2. A global dedup hit skips the quota check entirely

`app/api/versions/[id]/tracks/process/route.ts:174–179`, `:197–205`, `:266–276`
`app/api/versions/[id]/tracks/upload/route.ts:127–141`, `:247–263`

The dedup lookup is unscoped:

```
const { data: existing } = await supabase
  .from('tracks')
  .select('storage_path, duration_ms, file_size_bytes')
  .eq('file_hash', fileHash)     // ← no band, no project, no owner
  .limit(1)
  .maybeSingle()
```

and the quota call sits inside the `else` branch only:

```
if (existing) {
  storagePath = existing.storage_path          // no quota check
} else {
  const overQuota = await storageRefusal(...)  // quota check
  if (overQuota) return overQuota
  ...
}
```

**Reproduce:** upload file X to any band anywhere in the system. Then, from a free band
already at its 500 MB ceiling, upload the same bytes. The dedup branch is taken, no quota
check runs, and the track row is inserted carrying `existing.file_size_bytes`.

**What happens now:** the row *is* counted by `getBandStorageUsed` afterwards, so the band
goes over its ceiling and stays there. Any file already present anywhere in the database can
be added to any band, in any quantity, without a single refusal. The realistic path is not
adversarial: two bands sharing stems (one paid, one free), or a user who is a member of a
paid band and owner of a free one, moving the same files across.

A second consequence: on a dedup hit the new row points at `existing.storage_path`, which is
`projects/{someone else's project}/{hash}`. Combined with R6/R7 (no purge on band or track
deletion) this does not currently break anything, but the moment an R2 cleanup job is added
it will silently break tracks in other bands.

**What should happen:** either scope the dedup to the band (`existing` must belong to a
project in the same `band_id`), or keep the global dedup for the R2 write but still run
`storageRefusal` on the dedup branch — a dedup hit costs the band the same quota, because
`getBandStorageUsed` counts it.

---

### R3. `file_hash` is rewritable while `file_size_bytes` is not

`app/api/tracks/[id]/route.ts:81`

```
const allowed = ['file_hash', 'storage_path', 'midi_data', 'duration_ms', 'midi_start_bar', 'start_bar']
```

`file_size_bytes` is correctly excluded and the comment above it explains exactly why. But
`file_hash` and `storage_path` are writable, validated only for *shape*
(`isValidFileHash`, `isValidProjectObjectKey` against the same project).

**Reproduce:** in one project, upload a 1 MB file (row A: hash H₁, size 1 MB) and a 400 MB
file (row B: hash H₂, size 400 MB). `PATCH` row A with `{ file_hash: H₂, storage_path:
"projects/<same project>/<H₂>.flac" }`. Delete row B.

**What happens now:** the 400 MB object is still in R2 and still reachable through row A,
but `getBandStorageUsed` sums by unique hash and finds only row A's recorded
`file_size_bytes` of 1 MB. 400 MB stored, 1 MB counted, permanently.

**What should happen:** when `file_hash` changes, re-resolve `file_size_bytes` server-side
from the object the new hash names (or from another track row carrying that hash), rather
than leaving a stale count attached to a new object.

---

### R4. An owner can orphan their own band and free the slot

`app/api/bands/[id]/members/[userId]/route.ts:62`

```
if (requesterId !== targetUserId && membership.role !== 'owner') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

When `requesterId === targetUserId` the condition is false whatever the role, so an owner
removing *themselves* passes. `DELETE /api/bands/[id]/members/me` has a last-owner guard
(`members/me/route.ts:26–38`); this route has none.

**Reproduce:** own a band with at least one other member. `DELETE
/api/bands/{bandId}/members/{yourOwnUserId}`.

**What happens now:** the band has no `role='owner'` row. Consequences, all of them bad:

- `countOwnedBands` no longer counts it, so the owner's band slot is freed while the band,
  its projects and its data persist.
- `getBandEntitlements` falls back to free (`lib/entitlements.ts:392–403`) — correct
  fail-closed behaviour, and the only part of this that works as designed.
- `ensureBandFreezeState` returns early on a null owner (`lib/bandFreeze.ts:120–122`), so
  the band can **never** be frozen, by any path, ever again.
- The band is charged to nobody's plan for the rest of its life.

Repeated with a confederate account left as a member, this yields an unbounded number of
free, unfreezable, unowned bands.

**What should happen:** apply the same last-owner guard as `members/me` — refuse, and point
at band deletion or (if it existed) ownership transfer.

---

### R5. Preview mixes and abandoned uploads are never counted

`lib/previewMix.ts:50`, `:223–224` — every project caches a rendered MP3 at
`previews/{projectId}/mix.mp3`. `getBandStorageUsed` (`lib/bandStorage.ts:51–95`) sums
`tracks.file_size_bytes` and `project_resources.file_size_bytes` and nothing else, so
preview mixes are invisible to quota.

`app/api/versions/[id]/tracks/presign/route.ts:86–89` carries its own note:

```
// TODO: A cleanup job should periodically delete objects under temp/ older
// than 24 hours to reclaim storage for abandoned uploads
```

No such job exists anywhere in the repo (`scripts/` has none; there is no cron route).

**What happens now:** a browser closed mid-upload leaves a presigned object under `temp/`
forever. On a free band that is 200 MB of real storage per abandoned upload against a
500 MB plan, counted as zero.

**What should happen:** decide deliberately whether previews count (they are derived, so
arguably not — but then they need a size ceiling of their own), and ship the `temp/`
reaper. A Cloudflare R2 lifecycle rule on the `temp/` prefix is the cheapest version.

---

### R6. Deleting a band never purges R2

`app/api/bands/[id]/route.ts:459`

```
const { error } = await supabase.from('bands').delete().eq('id', bandId)
```

Contrast `app/api/projects/[id]/route.ts:303–333`, which walks every unique `file_hash` in
the project, checks whether any track outside the project still references it, and only then
calls `deleteFromR2`.

**What happens now:** band deletion cascades away every project, version and track row and
leaves every R2 object behind. This matters more than it looks, because deleting a band is
the path the product *recommends* for resolving a `too_many_bands` conflict
(`AGENTS.md:637–640`, `lib/bandLimitClient.ts:24–25`). The remedy for being over quota is
the action that orphans the most storage.

**What should happen:** reuse the purge walk from the project route, keyed on the band's
projects.

---

### R7. Deleting a track or a version never purges R2

`app/api/tracks/[id]/route.ts:37`, `app/api/versions/[id]/route.ts` (DELETE branch)

Both delete rows only. Quota is freed immediately — `getBandStorageUsed` is computed live
from the surviving rows, with no cached counter — so the *user* gets their space back at
once, correctly. The bytes do not go anywhere.

**What happens now:** measured usage and real usage diverge monotonically. Every band's R2
footprint is a high-water mark, not a current value.

**What should happen:** same purge-with-reference-check as the project route, or a
background reaper reconciling R2 against `tracks.storage_path`.

---

## User harm — a paying user denied, stuck, or misinformed

### U1. The dashboard reports 1 GB of storage to every plan

`app/api/dashboard/route.ts:74`, `:88`, `:245`, `:266`

```
storageLimitBytes: BAND_STORAGE_LIMIT_BYTES,
```

`BAND_STORAGE_LIMIT_BYTES` is the pre-plans flat 1 GB constant (`lib/bandStorage.ts:25`),
whose own docblock says *"Do not use it as an enforcement value."* The dashboard is the
app's primary surface and it never calls the resolver.

`app/api/bands/[id]/route.ts:347` does it correctly and is the model:

```
storageLimitBytes: mbToBytes(entitlements.storagePerBandMB) ?? bandStorageLimitBytes(),
```

**Reproduce:** load `/dashboard` on any plan. Every band card reads 1 GB.

**What happens now:** a free user (500 MB) is shown twice their real ceiling and is refused
at half of what the screen promised. A Band+ user (50 GB) is shown 2% of what they bought —
on the screen they look at most often. This is a refund conversation and a support ticket,
not a cosmetic issue.

**What should happen:** resolve per band via `getBandEntitlements(bandId)`. The dashboard
already calls `settleAccount(userId)` at `:97` and already reads frozen state per band, so
the per-band loop it needs exists.

---

### U2. Free members of a paid band are denied `ab_compare` and `chord_detect` outright

`components/StructureEditor.tsx:385`, `app/band/[bandId]/project/[projectId]/page.tsx:241`
(also `TrackRow.tsx:210`, `MergeModal.tsx:524`)

All four call sites use the one-argument form:

```
usePaywallGate('chord_detect')
```

`contexts/PaywallContext.tsx:176–182` resolves that against `snapshot.features` — the
**viewer's own** plan. The docblock (`:163–175`) acknowledges this and offers the fix:
*"Passing a bandId lifts that: pass one wherever the band is known."* All four call sites
are inside `/band/[bandId]/project/[projectId]`, so the band is known at every one of them,
and none passes it.

For `track_edit` and `cherry_pick` this is only an annoying under-promise: the server
(`tracks/[id]/edit/route.ts:91`, `projects/[id]/merge/route.ts:113`) resolves from the band
owner's plan and would allow the action.

For `ab_compare` and `chord_detect` **there is no server gate at all** — chord detection runs
in `public/workers/chordsWorker.js` and A/B compare is client playback. The client gate is
therefore the *only* gate, and it is resolving against the wrong plan. A free bandmate in a
Band+ owner's band is permanently locked out of two features the band paid for, with no
server-side path that would ever grant them.

**What should happen:** pass the band's feature list at all four call sites. The band detail
response already carries the resolved entitlements.

---

### U3. `enforced` never clears when the remaining conflict is not a band-count conflict

`lib/entitlements.ts:570–599` derives state from the `grace_until` timestamp alone:

```
if (deadline > now) return { state: 'grace', ... }
return { state: 'enforced', graceDaysLeft: 0, ... }
```

It never consults conflicts, despite the docblock two lines above claiming
*"active — no conflicts between the plan and the data"*.

The only thing that clears the deadline is `lib/bandFreeze.ts:199–202`:

```
if (state.graceUntil) {
  const remaining = await checkPlanConflicts(ownerId, state.plan)
  if (remaining.length === 0) await clearGrace(ownerId)
}
```

`checkPlanConflicts` reports four conflict types. `reconcileOwnerBands` can only *resolve*
one of them — `too_many_bands`, by freezing (`:158–171`). So a `storage_exceeded`,
`too_many_members` or `versions_exceeded` conflict keeps `grace_until` set forever.

**Reproduce:** on Band+ with three bands, one holding 30 GB, downgrade to Band (3 bands,
10 GB each). No band-count conflict, so nothing freezes. Wait 14 days.

**What happens now:** the account is `enforced` permanently. `splitBandsForFreeze` returns an
empty freeze set, so *nothing is actually enforced* — uploads were already refused by the
ordinary storage guard. The user sees a grace-expired banner that will never go away, on an
account where the only real consequence is the upload refusal they would have had anyway.
The only exit is getting back under 10 GB.

**What should happen:** either make the state derivation total by consulting conflicts (which
is what the docblock and `AGENTS.md:606–608` both describe), or let `enforced` decay back to
`active` once nothing freezable remains, leaving the ordinary per-action refusals to carry
the consequence.

---

### U4. Upgrading out of an expired grace re-freezes the bands you just paid to unfreeze

`lib/planChange.ts:125–130`

```
const needsGrace = direction === 'downgrade' && conflicts.length > 0
const graceUntil = needsGrace
  ? graceDeadlineFromNow()
  : conflicts.length > 0
    ? before.graceUntil        // ← keeps the OLD deadline, which may be in the past
    : null
```

then `:139–144`:

```
const after = await resolvePlanState(userId)
await reconcileOwnerBands(userId, after.state === 'enforced')
```

If any conflict survives the upgrade, the expired deadline is carried forward, `after.state`
resolves to `enforced`, and `reconcileOwnerBands` is called with `enforce: true` — **on an
upgrade**.

**Reproduce:** Band+ → Free (grace starts, expires, four bands freeze) → pay for Band+ again
through the Stripe portal. The webhook calls `changePlan(userId, 'band_plus', { force: true })`
(`app/api/stripe/webhook/route.ts:115`). The `force` flag bypasses the blocking-conflict
refusal but not this branch. If any conflict remains against `band_plus` — most plausibly a
`storage_exceeded` on one band, or a `too_many_members` that `force` deliberately tolerates —
the user's newly-paid account is `enforced` at the moment of purchase and
`reconcileOwnerBands` freezes the excess again.

**What happens now:** money moves, bands freeze. The comment at `:141–143` states the exact
opposite intent: *"An upgrade out of the enforced state unfreezes here, before the user
navigates anywhere."*

**What should happen:** an upgrade should clear an already-expired deadline unconditionally,
or at minimum re-arm a fresh one rather than inheriting a dead timestamp. This one I would
normally class as an unambiguous bug and fix, but it turns on whether a forced upgrade with
surviving conflicts should get a fresh grace period or none — a product call, so it is
flagged, not fixed.

---

### U5. Storage inside a frozen band cannot be freed except by deleting the band

`lib/supabase/server.ts:190–193` blocks writes by HTTP method:

```
if (isWriteRequest(req, options)) {
  const freeze = await ensureBandFreezeState(project.band_id)
  if (freeze.frozen) return { error: 'band_frozen', status: BAND_FROZEN_STATUS }
}
```

`DELETE /api/tracks/[id]` routes through `requireBandMemberForTrack` → `requireBandMember`,
and `DELETE` is in `WRITE_METHODS` (`:145`). So a frozen band refuses track deletion.

**Reproduce:** get a band frozen, then try to delete a track in it to get back under a
storage ceiling.

**What happens now:** refused. The documented escape hatches are removing members
(deliberately allowed) and deleting the whole band (`app/api/bands/[id]/route.ts:440`,
deliberately allowed). There is no way to free *space* selectively — the choice is the whole
band or nothing.

This is consistent with "a frozen band is read-only, nothing is ever deleted", so it may be
intended. It is listed because it is the one resolution action a user would reach for that
the product does not offer, and because `too_many_bands` and `too_many_members` both have
targeted escape hatches while `storage_exceeded` does not.

---

### U6. A sole owner cannot leave a band, and the route tells them to use a feature that does not exist

`app/api/bands/[id]/members/me/route.ts:33–38`

```
return NextResponse.json(
  { error: 'Transfer ownership before leaving — you are the only owner' },
  { status: 400 }
)
```

There is no ownership-transfer route, helper or UI anywhere in the repo. A grep for any write
of `role: 'owner'` outside band creation returns exactly one hit —
`lib/bandLimit.ts:179`, the creation insert. `PATCH /api/bands/[id]/members/[userId]` accepts
only `role_label` and `role_color` (`:39–44`) and refuses a requester who is not the target
(`:26–28`).

**What happens now:** a dead end. The only way out is the self-removal path in R4, which
orphans the band, or deleting the band and everyone's work with it.

**What should happen:** either build transfer (and re-check the new owner's band limit before
committing it — see the open question in *Needs a product decision*), or reword the error to
say what is actually possible.

---

### U7. Deleting an account destroys bands other people are working in, and does not cancel billing

`app/api/profile/account/route.ts:48–67`

```
if ((count ?? 0) <= 1) {
  const { error: bandErr } = await supabase.from('bands').delete().eq('id', m.band_id)
```

Since no path creates a second owner (U6), the owner count is always 1, so **every band the
departing user owns is deleted** — cascading through projects, versions, tracks and comments
— regardless of how many other people are in it.

Separately, `:81` calls `supabase.auth.admin.deleteUser(userId)`. Nothing cancels the Stripe
subscription. `billing_customers` is `on delete cascade` from `auth.users`
(`20260920_billing_stripe.sql:41`), so the `stripe_customer_id → user_id` link is destroyed
while the subscription keeps renewing, and the next webhook for that customer resolves to no
user (`webhook/route.ts:103–108`) and is logged and dropped.

**What happens now:** a four-person band vanishes because one person closed their account, and
that person keeps being charged with no record left that connects the charge to them.

**What should happen:** the billing half is an unambiguous Stripe blocker (see B6). The band
half is a product decision.

---

### U8. The client shows a stale plan after checkout, and never refreshes after the portal

`app/billing/BillingClient.tsx:81–88`

```
useEffect(() => {
  if (checkoutResult !== 'success') return
  const timer = setTimeout(() => { void refresh(); void loadBilling() }, 2500)
  return () => clearTimeout(timer)
}, [checkoutResult, refresh, loadBilling])
```

One shot at 2500 ms, no retry, no polling. The webhook chain it is racing is: Stripe
delivery → `subscriptions.retrieve` (a network round trip) → `changePlan` (which runs
`checkPlanConflicts`, an N+1 walk over every owned band and every project) →
`syncAddonsFromSubscription`. On an account with several bands that routinely exceeds 2.5 s.

The portal path (`:90–`, `openPortal`) returns the user with no query parameter at all, so
**no refresh fires** — a plan changed in the Stripe customer portal shows the old plan until
a hard reload.

**What happens now:** a user who has just paid sees their old plan and no explanation. Server
enforcement is correct throughout — this is display only — except for `ab_compare` and
`chord_detect`, where the client is the only gate (U2), and there a stale snapshot really does
withhold a feature they have paid for.

**What should happen:** poll `GET /api/me/plan` with backoff until the plan changes or a
ceiling is hit, on both the checkout and the portal return; add a return parameter to the
portal `return_url` (`app/api/billing/checkout/route.ts:89`).

---

### U9. Add-ons that are billed and grant nothing

Three distinct cases, all in `lib/entitlements.ts::resolveEntitlements`:

| Case | Line | Behaviour |
|---|---|---|
| `extra_member` on `band` / `band_plus` | `:312–316` | `addToLimit(null, n)` returns `null` — the addon is absorbed by the already-unlimited ceiling |
| `extra_band` on an account with a non-null `band_limit_override` | `:322–323` | the override replaces the computed value *after* addons are applied, discarding them |
| `extra_storage` on a band that is later deleted | `20260806:176` (`on delete cascade`) | the `plan_addons` row disappears; the Stripe subscription item does not |

`POST /api/billing/addons` accepts all three without complaint (`:127–139`) and creates a real,
proratable Stripe subscription item.

**What happens now:** the user is charged $2, $5 or $4 a month for nothing, repeatedly, with
no surface anywhere that would show them the addon is inert. The deleted-band case is the worst
of the three: `syncAddonsFromSubscription` resolves the band via `ownedBandId`
(`lib/billing/store.ts:270–280`), gets `null` for a deleted band, and `continue`s
(`:307`), so the item is never marked seen and never surfaces again — it just bills forever.

**What should happen:** refuse the purchase at `POST /api/billing/addons` when the addon
cannot grant anything under the buyer's current plan, and remove the Stripe subscription item
when the band an `extra_storage` / `extra_member` item names no longer exists. Whether an
inert addon should be refused or merely warned about is a product call.

---

### U10. The grandfathering override silently caps paid upgrades

`supabase/migrations/20260806_subscription_plans.sql:241–254`

```
update public.profiles p
   set band_limit_override = greatest(owned.n, p.band_limit)
  ...
 where owned.user_id = p.id
   and p.band_limit_override is null
   and owned.n > (select l.bands_owned from public.plan_limits l where l.plan = coalesce(p.plan, 'free'))
```

With `plan_limits.free.bands_owned = 1` (see S1), this fires for every account owning 2+
bands, and `p.band_limit` defaults to 3 (`20260817_profiles_band_limit_column.sql:81`), so the
override lands at **≥ 3**.

Because the override *replaces* rather than caps (`entitlements.ts:320–323` — deliberate, per
the brief), a grandfathered account that later buys Band+ gets **3** owned bands, not 5. An
`extra_band` purchase on top grants nothing (U9). Nothing in the code ever notices that an
override has fallen below the plan allowance, and nothing ever clears one.

**What happens now:** the earliest, most loyal beta users are the ones whose upgrades will be
silently capped at launch.

**What should happen:** a product decision on cap-vs-floor semantics (P1), plus — whichever
way that goes — a one-time pass at launch clearing overrides that are no longer above the
account's plan allowance.

---

### U11. Revoking an add-on arms no clock

`app/api/billing/addons/route.ts:155–158`

```
const updated = await stripe.subscriptions.retrieve(live.id)
await syncAddonsFromSubscription(userId, updated)
return NextResponse.json({ ok: true })
```

No `settleAccount(userId)`. Compare the dev tool, which gets this right in all three places —
`app/api/dev/plan/route.ts:164`, `:181`, `:190`.

**What happens now:** a user who removes an `extra_band` while using the extra capacity is
over their limit with no grace deadline, nothing frozen, and no banner, until some *other*
surface happens to call `settleAccount` — `GET /api/me/plan` (`:65`) or `GET /api/dashboard`
(`:97`). It self-heals on the next dashboard load, so the window is usually short, but it is
undefined rather than bounded.

**What should happen:** `await settleAccount(userId)` after the sync, matching the dev path.

---

## Spec divergence

### S1. `plan_limits.free.bands_owned` is seeded at **1**, not 3

`supabase/migrations/20260806_subscription_plans.sql:213–218`

```
insert into public.plan_limits (plan, bands_owned) values
  ('free', 1), ('solo', 1), ('band', 3), ('band_plus', 5)
on conflict (plan) do update set bands_owned = excluded.bands_owned;
```

The brief states this is seeded at 3 as a temporary beta setting *"so the migration was a
no-op on production"*. In this repo it is 1, and the value matches `PLANS.free.bandsOwned`
(`lib/plans.ts:92`) — so app and DB backstop agree, which is the invariant that matters most.

But the premise behind the claim does not hold: with `free = 1`, section 5 of that migration
(`:241–254`) is **not** a no-op. It writes a `band_limit_override` for every account owning
more than one band. That is the mechanism behind U10.

Note also the `on conflict do update`: re-running the migration resets `free` to 1, so a
hand-edit to 3 in the Supabase console would be silently reverted by the next idempotent
re-run.

**Which is correct:** the code. `free = 1` is the launch value and matches `lib/plans.ts`.
**What is needed:** confirm what production actually holds (`select * from public.plan_limits;`)
and how many accounts carry an override as a result.

---

### S2. The dashboard states a limit from a hardcoded constant

See U1. Called out separately here because it is precisely the category the brief asked to
flag: *"A limit enforced from a hardcoded constant rather than the shared resolver is a
finding."* It also violates `AGENTS.md:747` (*"No component may state a limit or a price"*)
and `AGENTS.md:1052` (*"Never hardcode a plan limit"*).

---

### S3. `track_editor` vs `track_edit`

The brief lists the gated features as `ab_compare, track_editor, chord_detect, cherry_pick`.
Code (`lib/plans.ts:42`) and `AGENTS.md:584` both use `track_edit`.

**Which is correct:** the code. `lib/plans.ts:38–40` documents the choice — the string is
shared with the pre-existing paywall keys and renaming it would be churn. The brief is the
outlier.

---

### S4. Two of four gated features have no server enforcement

| Feature | Server gate |
|---|---|
| `track_edit` | `app/api/tracks/[id]/edit/route.ts:91` |
| `cherry_pick` | `app/api/projects/[id]/merge/route.ts:113` (conditional on selective fields — correct, applying a whole version stays free) |
| `chord_detect` | none |
| `ab_compare` | none |

`AGENTS.md:631–635` documents the `chord_detect` case and its reason (browser worker, no
endpoint). `ab_compare` is not mentioned anywhere.

Neither consumes server resources, so neither is a direct cost leak. But `chord_detect`'s
*result* is persisted through `PATCH /api/sections/[id]` (`chords` field), which is ungated —
so a free user who bypasses the UI gate gets the full feature including persistence.

**Which is correct:** arguable. `chord_detect` is genuinely unenforceable as built. If the
feature is to stay gated in any meaningful sense, the gate has to move to the persistence of
the result rather than the computation of it. Flagged rather than fixed — that changes what
users can do.

---

### S5. `AGENTS.md` names the wrong override column

`AGENTS.md:600–602`:

> Order: plan base → `plan_addons` … → `profiles.band_limit`, which when non-null
> **REPLACES** the computed owned-bands limit outright

The plan system reads `profiles.band_limit_override`, not `profiles.band_limit`. The document
gets this right in §5 (`:842–850`) and §7 (`:1058–1063`) and explains at length why the two
columns must never be confused — which makes the one stale sentence in §4 actively dangerous
to a reader who stops there. `lib/entitlements.ts:24–30` is the authoritative account.

---

### S6. `resolvePlanState`'s docblock does not describe `resolvePlanState`

`lib/entitlements.ts:565–568`:

> Resolve the account state from `profiles.plan`, `grace_until` **and the actual data**.
> …  active — no conflicts between the plan and the data

The function reads `grace_until` and compares it to `Date.now()`. It never touches the data.
The "and the actual data" half lives in `settleAccount` / `reconcileOwnerBands` and only ever
*clears* a deadline, never sets a state. See U3 for the consequence.

---

### S7. Two upload paths record two different byte counts for the same dedup hit

`app/api/versions/[id]/tracks/upload/route.ts:140`

```
fileSizeBytes = existing.file_size_bytes ?? audioBuffer.byteLength   // raw, pre-FLAC
```

`app/api/versions/[id]/tracks/process/route.ts:274`

```
fileSizeBytes = existing.file_size_bytes ?? 0                        // deliberately 0
```

with a comment at `:275–277` explaining why the fallback must not be a client-influenced
number. The `upload` path's fallback is the raw uploaded WAV/MP3 length, which is the size of
a file that was *never stored* — storage holds the FLAC. It is both client-influenced and
wrong in magnitude, typically 2–3× the stored size for WAV.

**Which is correct:** `process`. The `upload` route should use the same `?? 0`.

This is the one finding in this report I would classify as an unambiguous bug where the code
contradicts itself rather than the spec — but since changing it changes recorded usage for
existing rows, it is reported rather than fixed.

---

## Undefined behaviour

### N1. Two owners break every band-scoped entitlement read

`lib/entitlements.ts:367–376`

```
const { data, error } = await supabase
  .from('band_members').select('user_id')
  .eq('band_id', bandId).eq('role', 'owner')
  .maybeSingle()
if (error) throw error
```

`.maybeSingle()` errors (PGRST116) when more than one row matches. That throw propagates
through `getBandEntitlements` into `assertCanAddMember`, `assertBandFeature`,
`assertStorageHeadroom`, `assertCanCreateVersion` and `getBandStorageQuota` — i.e. a band with
two owner rows returns 500 on every guarded action, not a degraded answer.

No API path creates a second owner today (U6), so this is unreachable through the app. It is
listed because `app/api/bands/[id]/members/me/route.ts:26–38` is written as though multiple
owners are an expected state, and because a future ownership-transfer feature implemented as
"insert new owner, then delete old" would pass through this state on every single transfer.

Also unresolved: the owned-band count. `countOwnedBands` (`:424–432`) counts owner rows, so
two owners charge the band to both accounts' allowances.

---

### N2. An ownerless band is fail-closed for limits but permanently unfreezable

`lib/entitlements.ts:392–403` resolves an ownerless band to the free plan — correct, and
explicitly documented as fail-closed. But `lib/bandFreeze.ts:120–122`:

```
const ownerId = await getBandOwnerId(bandId)
if (!ownerId) return current
```

returns the *stored* state without evaluating. So an ownerless band can never be frozen, and
one that was already frozen can never be released. Combined with R4 this is the mechanism by
which orphaned bands become permanent free capacity.

The comment — *"An ownerless band cannot be charged to anyone's plan. Leave it as it is."* —
is correct reasoning about *freezing*. It just also means the band escapes the system entirely.

---

### N3. Join requests can be filed against a frozen band and can never be approved

`app/api/bands/join/route.ts:70–78` inserts a `band_join_requests` row with no frozen check.
Approval (`app/api/bands/[id]/join-requests/[requestId]/route.ts`) calls
`isBandFrozenForWrite` and refuses.

**What happens now:** requests accumulate against a frozen band, the owner is push-notified
for each (`:87`), and every approval attempt fails. Nothing tells either party why.

Current behaviour is arguably fine — the request survives until the band is unfrozen, which is
kinder than refusing it — but it is accidental, not designed.

---

### N4. `claimEvent` silently disables duplicate protection when the table is absent

`lib/billing/store.ts:360–372`

```
if (!error) return true
if ((error as { code?: string }).code === '23505') return false
console.warn('[billing] could not claim event', eventId, error)
return true
```

The fallback is correct in intent — better to process an event twice than to drop it — but it
means that if `20260920_billing_stripe.sql` has not been applied (migrations are manual, per
`AGENTS.md §5`), every webhook is treated as fresh and the "backstop for the handler that
isn't idempotent" described at `:355–359` is simply not there. Nothing logs this as a
deployment problem; it is one `console.warn` per event.

---

### N5. Add-on cleanup is scoped by user, not by subscription

`lib/billing/store.ts:326–338`

```
const { data: existing } = await supabase
  .from('plan_addons').select('id, stripe_subscription_item_id')
  .eq('user_id', userId)                                   // ← every subscription
  .not('stripe_subscription_item_id', 'is', null)
const stale = ...filter(row => !seen.has(row.stripe_subscription_item_id))
```

`seen` is built from one subscription's items. With two subscriptions on one user, syncing
either one deletes all of the other's add-on rows.

---

### N6. The webhook applies one subscription without regard to the others

`app/api/stripe/webhook/route.ts:101–117`

`subscriptionGrantsPlan` returns `DEFAULT_PLAN` for any non-entitling status
(`lib/billing/store.ts:201–205`), and `applySubscription` passes that straight to `changePlan`.
There is no check for whether the user holds another, live subscription.

**Reproduce:** a user's card fails permanently, the subscription is canceled, they resubscribe
(a new subscription id). Any later event on the old subscription — `customer.subscription.deleted`
is commonly delivered late, and Stripe makes no ordering guarantee — resolves to `free` and
downgrades a paying customer, starting a 14-day grace period and eventually freezing bands.

`readLiveSubscription` (`:93–110`) already knows how to find the subscription that should be
authoritative. `applySubscription` does not use it.

---

### N7. Add-ons are synced after the plan, and nothing re-settles

`app/api/stripe/webhook/route.ts:112–116`

```
await changePlan(userId, subscriptionGrantsPlan(sub), { force: true })
await syncAddonsFromSubscription(userId, sub)
```

The ordering comment is right that addons resolved before the plan would be measured against
the old ceiling. But `changePlan` ends in `reconcileOwnerBands` (`planChange.ts:144`), which
reads addons — the *old* ones. A user who buys `band_plus` **and** an `extra_band` in one
checkout has their freeze decision computed as if they had bought only the plan.

There is no `settleAccount` after the sync. It self-heals on the next `GET /api/me/plan` or
`GET /api/dashboard`; until then, capacity they paid for is not reflected.

---

### N8. Nothing settles after a band is deleted

`app/api/bands/[id]/route.ts:459–462` deletes and returns. Deleting a band is the documented
remedy for a `too_many_bands` conflict, so it is the single most likely moment for an account
to become compliant — and it is the one moment nothing calls `settleAccount`. The grace
deadline and the other bands' frozen flags stay as they were until another surface settles.

---

### N9. Leaving a frozen band is allowed and undocumented

`app/api/bands/[id]/members/me/route.ts` has no frozen check. Removing a member from a frozen
band is documented as deliberate; a member removing *themselves* is the same operation from the
other side and is presumably fine, but it is not stated anywhere, so a future reader adding a
frozen guard "for consistency" would break the symmetry that makes `too_many_members`
resolvable.

---

## Stripe blockers

### B1. `syncAddonsFromSubscription` cannot execute — partial index, unqualified `ON CONFLICT`

`lib/billing/store.ts:311–322`

```
const { error } = await supabase.from('plan_addons').upsert(
  { user_id, band_id, addon_type, quantity, stripe_subscription_item_id: item.id, ... },
  { onConflict: 'stripe_subscription_item_id' },
)
if (error) throw error
```

`supabase/migrations/20260920_billing_stripe.sql:138–140`

```
create unique index if not exists idx_plan_addons_stripe_item
  on public.plan_addons (stripe_subscription_item_id)
  where stripe_subscription_item_id is not null;          -- ← partial
```

PostgREST compiles `onConflict` to `ON CONFLICT (stripe_subscription_item_id) DO UPDATE`.
Postgres will not infer a **partial** unique index from a bare column list — the index
predicate has to appear in the statement — so this raises `42P10`,
*"there is no unique or exclusion constraint matching the ON CONFLICT specification"*.

**Blast radius, both callers:**

- `POST /api/billing/addons` (`:156`) — throws, caught at `:159`, returns 500. The Stripe
  subscription item has *already been created* at that point (`:133–139`), so the user is
  billed and no `plan_addons` row exists. Retrying creates a second item.
- `POST /api/stripe/webhook` (`:116`) — throws, hits the catch at `:196`, `releaseEvent`s and
  returns 500. Stripe retries. But `changePlan` at `:115` **already committed** the plan
  change, so each retry re-runs `changePlan` (idempotent, fine) and re-fails the sync. Stripe
  retries for up to three days and then gives up. Net state: plan applied, add-ons never
  applied, no alert beyond a log line.

**What should happen:** make the index total —

```
alter table public.plan_addons
  add constraint plan_addons_stripe_item_key unique (stripe_subscription_item_id);
```

A plain `UNIQUE` constraint permits multiple NULLs in Postgres, so hand-granted rows (which
the migration's comment at `:129–130` explicitly protects) keep working, and `ON CONFLICT`
becomes inferable. Then drop `idx_plan_addons_stripe_item`.

This is the one finding I would call a hard blocker: the integration does not function with it
in place, and it is invisible until a real add-on is purchased.

---

### B2. Grace state cannot be reconstructed from Stripe

The brief asks whether effective entitlements can be recomputed deterministically from
`profiles.plan` + `plan_addons` alone. For **limits and features**: yes. `resolveEntitlements`
(`lib/entitlements.ts:278–335`) is a pure function of `(plan, addons, band_limit_override,
bandId)` with no history dependence. That part of the seam is sound.

For **account state**: no. `grace_until` and `grace_keep_band_ids` are history, written only by
`changePlan` on a downgrade (`planChange.ts:132–136`) and by `startGrace`
(`bandFreeze.ts:278–284`). A reconciliation pass driven from a Stripe subscription has no way to
know whether a downgrade happened, when, or what the user chose to keep.

`settleAccount` (`bandFreeze.ts:255–267`) can re-arm a grace period, but **only** for an
owned-band-count conflict, and it says so:

> Only the owned-band count is checked here, deliberately. … members, storage and versions are
> all refused at the point of creation, so they can only go over when a plan shrinks, and a
> shrinking plan arms the clock on its own.

That reasoning holds while `changePlan` is the only way a plan shrinks. It stops holding the
moment Stripe can shrink a plan through a path that loses the write — e.g. B1's failure mode,
a webhook Stripe eventually abandons, or a manual dashboard edit that predates the customer
record.

**What should happen:** decide whether a lost `grace_until` should fail open (no grace, immediate
enforcement — harsh) or fail closed (fresh 14 days on detection — forgiving, and re-armable
indefinitely by a user who keeps triggering it). Then extend `settleAccount` to cover the
remaining three conflict types, or accept the gap explicitly.

---

### B3. `changePlan` is idempotent for grace, but order-dependent and not atomic

Three separate questions from the brief, answered separately.

**Is it idempotent?** For the case that matters — the same webhook delivered twice — **yes**.
Second call: `before.plan` already equals `to`, so `direction === 'none'`, so
`needsGrace === false` (`:125`), so the existing deadline is preserved rather than reset
(`:126–130`), and `grace_keep_band_ids` is preserved too (`:134`). No second grace period, no
re-freeze beyond re-asserting the state that already holds. Verified by walking
`free → band → free` and `band → free → free`.

It is not *cheap*, though: every call re-runs `checkPlanConflicts`, which is an N+1 walk —
one `getBandEntitlementsForPlan` per owned band (`planConflicts.ts:175`, each of which re-reads
the profile and the addons) plus one `countActiveVersions` per project (`:209`). A duplicate
webhook costs a full re-scan.

**Does it behave correctly when the change is to the plan already held?** Yes, and deliberately —
the fall-through comment at `:114–118` documents that re-selecting the current plan is how the
flow is re-run after a conflict is resolved. The one edge: if conflicts have been resolved in
the meantime, the second call clears the deadline. That is correct, not a bug.

**Is it atomic?** No. `:136` writes `plan` and `grace_until` in one row update (atomic between
themselves), then `:144` calls `reconcileOwnerBands` separately. If that throws, the plan is
committed and the freeze state is not.

The failure is benign in both directions, which is worth stating precisely rather than leaving
as a worry:

- *Downgrade:* `grace_until` was just set to +14 days, so `after.state` is `grace`, so
  `enforce` is `false` and there was nothing to freeze anyway. No paid capacity is retained
  beyond the grace period the user was entitled to.
- *Upgrade:* frozen bands stay frozen until the next `settleAccount` — which every plan surface
  calls (`me/plan:65`, `dashboard:97`). Self-healing, bounded by one page load.

**Order dependence** is the real Stripe concern. `direction` is computed from the *current*
`profiles.plan` (`:100–102`), not from the subscription. Stripe guarantees no ordering, so two
events arriving reversed produce the same final `plan` but potentially different `grace_until`.
That is inherent to a history-bearing column and is the same gap as B2.

---

### B4. Nothing cancels billing when an account is deleted

See U7. `app/api/profile/account/route.ts:81` deletes the auth user; `billing_customers`
cascades (`20260920_billing_stripe.sql:41`), destroying the `stripe_customer_id → user_id` link
while the subscription renews. Subsequent webhooks resolve to no user and are dropped with a
warning (`webhook/route.ts:103–108`).

Must be fixed before the first real charge: cancel the subscription (or at minimum retain the
customer row) before deleting the user.

---

### B5. Webhook user resolution falls back to dashboard-editable metadata

`app/api/stripe/webhook/route.ts:90–91`

```
const claimed = metadata?.supabase_user_id
return typeof claimed === 'string' && claimed ? claimed : null
```

The plan itself is correctly resolved from the Price id and never from metadata
(`lib/billing/config.ts:69–82`) — that decision is right and well-reasoned. But the *user* falls
back to metadata whenever the customer is unknown to `billing_customers`. Anyone with Stripe
dashboard write access can set `supabase_user_id` on a subscription and grant a plan to an
arbitrary account.

Outside the stated security scope, so flagged not fixed, but it belongs on the pre-launch list
alongside the other Stripe items.

---

## Verified correct

These were walked explicitly and behave as specified.

**Storage counts unique stored objects, not references.** `lib/bandStorage.ts:68–81` accumulates
into `seenHashes` and adds `file_size_bytes` only on first sight of a `file_hash`. A file
referenced by track rows in five versions is counted **once**. Snapshot versioning does not
inflate usage, and a user who branches a project five times pays for one copy. This was the
question most likely to have a bad answer; the answer is good.

**Deleting a track frees quota immediately.** Usage is recomputed live on every read — there is
no cached counter anywhere — so the row disappearing is the quota returning, in the same
request.

**Grace is evaluated on read and handles arbitrarily old timestamps.**
`lib/entitlements.ts:581–598` parses `grace_until`, guards `NaN` (`:584`), and compares to
`Date.now()`. A user who vanishes for six months and returns resolves to `enforced` on their
first request, and the first band they touch freezes via `ensureBandFreezeState`
(`bandFreeze.ts:127–130`). There is no window in which an expired grace is treated as live.

**"Active version" matches the spec exactly.** `countActiveVersions` (`:449–458`) filters
`type = 'branch'` **and** `merged_at is null`. Master is excluded because it is not a branch;
applied branches are excluded because they are history. `assertCanCreateVersion`
(`planGuards.ts:145–156`) checks `current + 1` against the ceiling, so free tops out at exactly
3 live branches.

**Pending join requests do not count toward the member limit.** `assertCanAddMember`
(`planGuards.ts:52–63`) calls `countBandMembers`, which counts `band_members` rows only
(`entitlements.ts:435–442`). `band_join_requests` rows are never counted. A band at 3/3 can hold
any number of pending requests; approval is what is refused. This is the right semantics —
charging for a request the owner has not accepted would be wrong.

**The dev plan switcher is doubly gated and both gates are independent.**
`components/plan/DevPlanSwitcher.tsx:141` (`if (!DEV_PLAN_TOOLS_AVAILABLE) return null`),
`app/api/me/plan/route.ts:136` (404), `app/api/dev/plan/route.ts:69` and `:90` (404). All four
read `lib/devPlanTools.ts:17`, `process.env.NODE_ENV === 'development'`. `next build` sets
`NODE_ENV=production` for every deployment including Vercel previews, so the UI is absent and
the routes 404 in every build that is not `next dev`. Checked as two independent gates, as
asked: removing either one leaves the other standing. The 404-not-403 choice is correct.

**Frozen-band write coverage is complete.** All 82 route handlers enumerated and classified:

- Project-scoped routes (32) inherit the block from `requireBandMember`, keyed on HTTP method
  (`lib/supabase/server.ts:190–193`), so every current and future mutation is covered without
  per-route memory. `readOnlyRequest: true` appears on exactly two routes —
  `projects/[id]/merge/preview` and `projects/[id]/preview-mix/recompute` — both genuinely reads
  that use POST, both correct.
- Band-level routes carry explicit `frozenBandRefusal` / `isBandFrozenForWrite`:
  `bands/[id]` (PATCH), `bands/[id]/invite-code`, `bands/[id]/members/[userId]` (PATCH),
  `bands/[id]/messages`, `bands/[id]/projects`, `bands/[id]/join-requests/[requestId]`,
  `projects` (POST, band branch), `versions/[id]/structure/submit`,
  `projects/[id]/resources/lyrics`, `projects/[id]/resources/process`,
  `projects/[id]/resources/[resourceId]`.
- Deliberate exemptions: `bands/[id]` DELETE, `bands/[id]/members/[userId]` DELETE.
- Inert: `bands/[id]/invites`, `bands/[id]/invites/current`, `invites/[token]/accept` — all
  410 stubs, correctly implemented as functions rather than module-level constants.
- Gaps found: `bands/join` POST (N3), `bands/[id]/members/me` DELETE (N9). Neither writes band
  content.

No route authenticates by hand and then writes band content without a frozen check. The four
routes the security audit fixed are still fixed.

**Members are never removed automatically.** No code path anywhere deletes a `band_members` row
except at explicit user request: `members/[userId]` DELETE, `members/me` DELETE, and the
account-deletion walk. Freezing touches only `bands.frozen_at` / `frozen_reason`
(`bandFreeze.ts:89–97`). `changePlan` never touches membership. Verified by grepping every
`.from('band_members').delete()` in the tree.

**Nothing is deleted as a consequence of a plan change.** `setFrozen` writes two columns.
Downloads (`tracks/[id]/download`, `tracks/[id]/stream`, `versions/[id]/export`) are GET and are
never blocked. Chat history, playback and viewing all survive. Confirmed end to end.

**Freeze ordering uses real activity.** `listOwnedBands` (`entitlements.ts:489–501`) reads
`band_activity` ordered by `created_at desc` and takes the first row per band, falling back to
`bands.created_at` **only** for bands with no activity at all (`:513`). The fallback is
deliberate and correct — the docblock at `:471–474` explains that a brand-new empty band would
otherwise sort as infinitely stale and be frozen first. This is not `created_at` masquerading as
activity; it is activity with a sensible floor.

**The freeze split honours the user's choice and tolerates bad input.**
`lib/freezeOrder.ts:54–89`: explicit keeps first in the user's own priority order, ignoring ids
they no longer own (`:73`); remaining slots to most-recently-active; the rest are freeze
candidates, least-recently-active first. Stale ids, duplicate ids, and a keep list longer than
the limit are all handled. Ties break on id for stability (`:42`). Being pure, it gives the
preview screen and the enforcement pass provably the same answer.

**Band creation is race-safe; the others are not.** `effective_band_limit`
(`20260807_plans_db_enforcement.sql:93–97`) takes `for update` on the profiles row, and
`create_band_with_owner` (`:208–257`) runs the check and both inserts in one PostgREST
transaction, with the trigger as a backstop. Member, version and storage checks are
check-then-act with no lock. **Your description of this is still accurate** — nothing has
drifted.

**The `plan_limits` mirror matches `lib/plans.ts`** for all four plans on `bands_owned`, which
is the only column it carries. The DB backstop and the app agree.

**`subscriptionGrantsPlan` resolves from the Price id, never metadata**
(`lib/billing/store.ts:201–205`, `lib/billing/config.ts:69–82`). Correct, and the reasoning in
the comment is right.

**`claimEvent` / `releaseEvent` are correctly paired** (`webhook/route.ts:140–141`, `:198`) —
the claim is handed back on a failed handler so Stripe's retry is not silently skipped.

**The override replaces plan base and add-ons, as specified** (`entitlements.ts:320–323`), and
`readAddons` floors a malformed `quantity` to 0 rather than granting capacity (`:241`).

**Removing a member from a frozen band works**, as intended, and is the resolution path for
`too_many_members` (verified against `members/[userId]` DELETE, which has no frozen guard).

---

## Could not verify — needs the live database

| Question | Query / step |
|---|---|
| What is production's actual free band allowance? (S1) | `select * from public.plan_limits order by bands_owned;` |
| Is there anything preventing two `role='owner'` rows? (N1) — `band_members` is not created by any file in `supabase/migrations/`, so its constraints are unknown | `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.band_members'::regclass;` |
| Which migrations have actually been applied? | `select proname from pg_proc where proname in ('effective_band_limit','create_band_with_owner');` and `select table_name from information_schema.tables where table_schema='public' and table_name like 'billing_%';` |
| How many accounts carry an override, and how many are now *below* their plan allowance? (U10) | `select p.id, p.plan, p.band_limit_override, l.bands_owned from public.profiles p join public.plan_limits l on l.plan = p.plan where p.band_limit_override is not null;` |
| Does the `ON CONFLICT` failure reproduce? (B1) | Against staging: `insert into plan_addons (user_id, addon_type, band_id, quantity, stripe_subscription_item_id) values (…) on conflict (stripe_subscription_item_id) do update set quantity = excluded.quantity;` — expect `42P10` |
| Real R2 footprint vs. counted usage (R5–R7) | `aws s3 ls --recursive --summarize` per prefix (`projects/`, `previews/`, `temp/`), compared against `sum(file_size_bytes)` over distinct `file_hash` |
| Whether any account currently has an expired `grace_until` with only non-band conflicts (U3) | `select id, plan, grace_until from public.profiles where grace_until < now();` then run `checkPlanConflicts` for each |

Also untestable without running it: there is no test suite in the repo (`AGENTS.md §7`), so
every behaviour above was established by reading, not by execution. The state-machine
transitions in particular would benefit from a small table-driven harness over `changePlan` —
it is a pure enough function of `(plan, conflicts, grace_until)` to make that cheap.

---

## Needs a product decision

Listed with the trade-off, not a recommendation.

**P1 — Should `band_limit_override` cap or floor?** Today it replaces, so a grandfathered
account that upgrades can end up with *less* than they paid for (U10). Floor semantics
(`max(override, plan_allowance + addons)`) preserve the grandfathering intent and stop
punishing upgrades, but they also mean a B2B deal can never be used to *restrict* an account.

**P2 — Should a downgrade during an existing grace period reset the clock?** Today it starts a
fresh 14 days (`planChange.ts:126`). Resetting is generous and gameable — repeated downgrades
extend indefinitely. Keeping the original deadline is stricter but can leave a user with hours
to resolve a conflict created by the new downgrade.

**P3 — Should `enforced` persist when the only remaining conflict is one freezing cannot fix?**
(U3.) Today it does, forever, and enforces nothing. Options: consult conflicts in the state
derivation; let `enforced` decay to `active` once nothing freezable remains; or extend
enforcement to cover storage and versions with some consequence other than freezing.

**P4 — Should add-ons that grant nothing be refusable at purchase?** (U9.) Refusing is honest
but means `POST /api/billing/addons` has to reason about what a plan already includes — which
puts plan logic in the billing route, cutting against the seam the whole design is built on.
Allowing them and warning in the UI keeps the seam clean at the cost of billing for nothing.

**P5 — Should deleting an account destroy bands other people are in?** (U7.) Today the
sole-owned band and all its content is deleted. Alternatives: orphan the band and let members
carry on under free limits; force a transfer before deletion is permitted; or soft-delete with a
reclaim window.

**P6 — Should ownership transfer exist, and should it re-check the new owner's limit?** (U6.)
The brief asks what happens if the new owner is already at their limit. Nothing happens today
because transfer does not exist. If built: refusing the transfer strands the old owner;
allowing it puts the new owner immediately over their limit, which the system handles gracefully
(nothing is deleted, grace arms via `settleAccount`) — arguably the better answer, but it means
a user can be pushed over a ceiling by someone else's action.

**P7 — Should the client gate resolve against the band's plan?** (U2.) Doing so fixes the
under-promise and is the only way to make `ab_compare` and `chord_detect` work for free members
of paid bands. It also tells every member something about the owner's plan.

**P8 — Should `past_due` keep entitling the plan?** (`lib/billing/store.ts:49`.) The reasoning
in the comment is sound — not punishing an expired card with data-loss-shaped consequences. But
Stripe's retry schedule can run for weeks, and the plan is free during all of it. Worth a
deliberate ceiling.

---

## Summary

| Category | Count | Must fix before Stripe |
|---|---|---|
| Revenue leak | 7 | R1, R2 |
| User harm | 11 | U1, U4, U8 |
| Spec divergence | 7 | S1 (confirm), S2 |
| Undefined behaviour | 9 | N5, N6, N7 |
| Stripe blocker | 5 | all |

**The three I would fix first, in order:**

1. **B1** — the integration does not work at all with it in place, and it fails silently after
   the money has moved.
2. **R1** — one unguarded route, unbounded cost, a two-line fix.
3. **U1** — wrong on the most-viewed screen, in both directions, for every plan.

Nothing has been changed in the codebase. Every finding above is reported only.
