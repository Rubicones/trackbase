/**
 * R2 temporary upload keys — format must match presign issuers exactly.
 *
 * Track presign:    temp/{uuid}-{sanitizedFilename}           (suffix max 100)
 * Resource presign: temp/resources/{uuid}-{sanitizedFilename}  (suffix max 120)
 *
 * Process routes MUST reject any key that does not match before touching R2.
 */

/** crypto.randomUUID() v4 — lowercase hex, fixed segment layout. */
const UUID_V4 =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

const SAFE_FILENAME = '[a-zA-Z0-9._-]'

/** Max sanitized filename length in tracks/presign/route.ts */
export const TRACK_TEMP_FILENAME_MAX = 100

/** Max sanitized filename length in lib/resource-presign.ts */
export const RESOURCE_TEMP_FILENAME_MAX = 120

/** temp/{uuid}-{filename} */
export const TRACK_TEMP_KEY_RE = new RegExp(
  `^temp/${UUID_V4}-${SAFE_FILENAME}{1,${TRACK_TEMP_FILENAME_MAX}}$`,
)

/** temp/resources/{uuid}-{filename} */
export const RESOURCE_TEMP_KEY_RE = new RegExp(
  `^temp/resources/${UUID_V4}-${SAFE_FILENAME}{1,${RESOURCE_TEMP_FILENAME_MAX}}$`,
)

export type TempKeyKind = 'track' | 'resource'

function patternFor(kind: TempKeyKind): RegExp {
  return kind === 'track' ? TRACK_TEMP_KEY_RE : RESOURCE_TEMP_KEY_RE
}

/** Max total key length (prefix + uuid + dash + suffix). */
function maxKeyLength(kind: TempKeyKind): number {
  return kind === 'track'
    ? 'temp/'.length + 36 + 1 + TRACK_TEMP_FILENAME_MAX
    : 'temp/resources/'.length + 36 + 1 + RESOURCE_TEMP_FILENAME_MAX
}

/**
 * Returns true only when tempKey is a non-empty string matching the presign
 * format for the given upload kind. Rejects path traversal and final keys.
 */
export function isValidTempKey(tempKey: unknown, kind: TempKeyKind): tempKey is string {
  if (typeof tempKey !== 'string') return false
  if (tempKey.length === 0 || tempKey.length > maxKeyLength(kind)) return false
  if (tempKey.includes('..') || tempKey.includes('\\')) return false
  return patternFor(kind).test(tempKey)
}

/** Extract the UUID embedded in a validated temp key (for final resource paths). */
export function uuidFromTempKey(tempKey: string, kind: TempKeyKind): string | null {
  if (!isValidTempKey(tempKey, kind)) return null
  const segment = tempKey.slice(tempKey.lastIndexOf('/') + 1)
  // Validated shape: {36-char uuid}-{filename}
  if (segment.length < 38 || segment[36] !== '-') return null
  return segment.slice(0, 36)
}
