/**
 * Build a `Content-Disposition: attachment` value that survives non-ASCII
 * filenames.
 *
 * HTTP header values are latin-1. Putting a Cyrillic (or any non-ASCII)
 * project/track/resource name straight into the header makes the `Response`
 * constructor throw `ERR_INVALID_CHAR`, which surfaces as a 500 on an
 * otherwise-successful download. Percent-encoding the whole name instead
 * "works" but hands the user a file called `%D0%9C%D0%BE%D1%8F.wav`.
 *
 * RFC 6266/5987 covers both: a stripped ASCII `filename` for anything that
 * only understands the old form, and `filename*=UTF-8''…` which every current
 * browser prefers.
 */
export function attachmentDisposition(filename: string): string {
  const ascii =
    filename
      // Quotes and backslashes would break out of the quoted-string.
      .replace(/["\\]/g, '')
      .replace(/[^\x20-\x7e]/g, '')
      .trim() || 'download'

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
