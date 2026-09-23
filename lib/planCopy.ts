/**
 * The words for every limit, in one place.
 *
 * A limit-reached state must always say three things: WHICH limit, WHAT the
 * number is, and WHAT would lift it. Never a generic error, never a spinner
 * that stops. Wording it once means the server's refusal, the pre-flight check
 * in the mixer, and the plan panel all say the same sentence — a user who sees
 * "3 active versions" in one place and "three branches" in another has to work
 * out whether they are the same rule.
 *
 * Isomorphic: no server-only imports, so both sides can use it.
 */

import {
  FEATURE_LABELS,
  formatMB,
  type AddonType,
  type GatedFeature,
  type Limit,
  type PlanId,
} from '@/lib/plans'

export type LimitType = 'bands' | 'members' | 'storage' | 'versions' | 'feature'

export interface LimitDescriptor {
  limit_type: LimitType
  limit?: number | null
  current?: number
  feature?: GatedFeature
  band_id?: string
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many
}

/** The headline: which limit, and what the number is. */
export function limitHeadline(d: LimitDescriptor): string {
  const limit = d.limit ?? null

  switch (d.limit_type) {
    case 'bands':
      return limit === null
        ? 'You have reached your space limit.'
        : `You already own ${limit} ${plural(limit, 'space')} — the most your plan allows.`

    case 'members':
      return limit === null
        ? 'This space has reached its member limit.'
        : `This space is at its limit of ${limit} ${plural(limit, 'member')}.`

    case 'storage':
      return `This space has used all of its ${formatMB(limit === null ? null : limit / (1024 * 1024))} of storage.`

    case 'versions':
      return limit === null
        ? 'This project has reached its version limit.'
        : `This project already has ${limit} active ${plural(limit, 'version')}.`

    case 'feature':
      return d.feature
        ? `${FEATURE_LABELS[d.feature]} is not included in this space's plan.`
        : 'That feature is not included in this space\'s plan.'
  }
}

/** The follow-up: what the user can actually do about it. */
export function limitRemedy(d: LimitDescriptor): string {
  switch (d.limit_type) {
    case 'bands':
      return 'Upgrade your plan, or delete a space you no longer need. Spaces you join do not count — joining is unlimited on every plan.'
    case 'members':
      return 'The space owner can upgrade to raise this. Nobody is removed automatically; existing members stay.'
    case 'storage':
      return 'Delete tracks or files to free space, or ask the space owner to upgrade. Storage is per space, so other spaces are unaffected.'
    case 'versions':
      return 'Apply or delete a version to free a slot, or upgrade for unlimited versions. Master never counts toward this.'
    case 'feature':
      return 'Upgrade the space to unlock it. Everyone in the space gets it, not just the owner.'
  }
}

/** Single-sentence form, for toasts and API `message` fields. */
export function limitMessage(d: LimitDescriptor): string {
  return `${limitHeadline(d)} ${limitRemedy(d)}`
}

/** Human copy for a frozen band. Files are safe — say so explicitly. */
export const FROZEN_BAND_MESSAGE =
  'This space is frozen because its owner’s plan no longer covers it. Nothing has been deleted — every file, comment and version is still here, and you can still listen and download. Upgrade, or delete enough other spaces to fit the limit, and it unfreezes immediately.'

export const FROZEN_BAND_SHORT = 'Frozen — read-only. Nothing was deleted.'

/**
 * Recognise a structured refusal from any endpoint, and turn it into
 * displayable copy. Returns null when the payload is some other error.
 */
export function parseLimitRefusal(data: unknown): LimitDescriptor | null {
  if (!data || typeof data !== 'object') return null
  const body = data as Record<string, unknown>
  if (body.error !== 'limit_reached') return null
  const type = body.limit_type
  if (
    type !== 'bands' && type !== 'members' && type !== 'storage' &&
    type !== 'versions' && type !== 'feature'
  ) return null

  return {
    limit_type: type,
    limit: typeof body.limit === 'number' ? body.limit : null,
    current: typeof body.current === 'number' ? body.current : undefined,
    feature: typeof body.feature === 'string' ? (body.feature as GatedFeature) : undefined,
    band_id: typeof body.band_id === 'string' ? body.band_id : undefined,
  }
}

export function isFrozenBandRefusal(data: unknown): boolean {
  return !!data && typeof data === 'object' && (data as { error?: unknown }).error === 'band_frozen'
}

/**
 * The one place an API error becomes a sentence for the user.
 *
 * Structured refusals (`limit_reached`, `band_frozen`) get their real copy;
 * anything else falls back to the endpoint's own `message`/`error` string, and
 * finally to the caller's fallback. Displaying `data.error` raw would surface
 * machine codes like "limit_reached" to people.
 */
export function apiErrorMessage(data: unknown, fallback: string): string {
  const refusal = parseLimitRefusal(data)
  if (refusal) return limitMessage(refusal)
  if (isFrozenBandRefusal(data)) return FROZEN_BAND_MESSAGE

  if (data && typeof data === 'object') {
    const body = data as { message?: unknown; error?: unknown }
    if (typeof body.message === 'string' && body.message) return body.message
    if (typeof body.error === 'string' && body.error) return body.error
  }
  return fallback
}

/**
 * Why an add-on is not offered on the current plan — shown beside a disabled
 * `+` rather than letting the purchase run into `addon_without_effect`.
 */
export function addonWithoutEffectCopy(type: AddonType): string {
  switch (type) {
    case 'extra_band':
      return 'Your plan already includes unlimited spaces.'
    case 'extra_storage':
      return 'Your plan already includes unlimited storage.'
    case 'extra_member':
      return 'Your plan already includes unlimited members.'
  }
}

/**
 * One line on who each plan is for. Shared by the plans modal and the landing
 * page's pricing section so the two describe the same plans in the same words.
 * Describes people, never limits or prices — those are generated.
 */
export const PLAN_BLURBS: Record<PlanId, string> = {
  free: 'A real workspace for a first record, not a disposable trial.',
  solo: 'For independent musicians working alone or with one collaborator.',
  band: 'For small bands actively working together.',
  band_plus: 'For groups running multiple projects across several spaces.',
}

export type { Limit }
