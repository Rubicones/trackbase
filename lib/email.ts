/**
 * Transactional email.
 *
 * ⚠ THERE WAS NONE BEFORE THIS FILE. The only mail this product has ever sent
 * is Supabase Auth's own sign-in link, sent by Supabase, not by app code —
 * there is no provider, no API key and no `from` domain configured anywhere.
 * So this module ships **inert**: with the environment unset it logs what it
 * would have sent and reports `not_configured`, and every caller carries on.
 *
 * That is deliberate rather than lazy. The alternative — leaving the notify
 * call out until a provider exists — means the code path that tells someone
 * they were removed from a space is the one nobody writes, and the feature
 * ships silent. This way the path is complete and tested, and it starts
 * delivering the day three variables are set.
 *
 * To turn it on:
 *   EMAIL_API_KEY   provider API key (server-only, never NEXT_PUBLIC_)
 *   EMAIL_FROM      verified sender, e.g. "sonicdesk <hello@sonicdesk.studio>"
 *   EMAIL_API_URL   optional; defaults to Resend's endpoint, which the payload
 *                   below matches. Any provider taking {from,to,subject,html}
 *                   as JSON with a bearer token works unchanged.
 *
 * Never throws. A notification is not worth failing the action it describes.
 */

const API_URL = process.env.EMAIL_API_URL ?? 'https://api.resend.com/emails'

export type EmailResult =
  | { sent: true }
  | { sent: false; reason: 'not_configured' | 'failed' }

export interface Email {
  to: string
  subject: string
  /** Plain text. The HTML part is generated from it — see `sendEmail`. */
  body: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * One plain-text body in, both parts out.
 *
 * Callers write prose, not markup. A notification that arrives as a wall of
 * branded HTML reads as marketing; these are messages about somebody's work.
 */
function toHtml(body: string): string {
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')

  return (
    `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;color:#111;` +
    `max-width:560px;margin:0 auto;padding:24px">${paragraphs}</div>`
  )
}

export async function sendEmail(email: Email): Promise<EmailResult> {
  const key = process.env.EMAIL_API_KEY
  const from = process.env.EMAIL_FROM

  if (!key || !from) {
    // Logged, not swallowed: until a provider exists this is the only record
    // that the product tried to tell someone something.
    console.warn(
      `[email] NOT CONFIGURED — would have sent to ${email.to}: "${email.subject}"\n${email.body}`,
    )
    return { sent: false, reason: 'not_configured' }
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: email.to,
        subject: email.subject,
        text: email.body,
        html: toHtml(email.body),
      }),
    })

    if (!res.ok) {
      // No response body in the log: provider errors can echo the recipient.
      console.error(`[email] provider refused (${res.status}) for "${email.subject}"`)
      return { sent: false, reason: 'failed' }
    }
    return { sent: true }
  } catch (err) {
    console.error('[email] send failed for', email.subject, err)
    return { sent: false, reason: 'failed' }
  }
}
