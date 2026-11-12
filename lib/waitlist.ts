import { escapeHtml } from './email'

// Input handling for the public waitlist, kept pure so it can be tested.
//
// The bottom-of-page form asks for an email address only. The route used to
// require a name, so every one of those signups was rejected with a 400 —
// and the form never looked at the response, so it told each visitor they were
// on the list. A name is optional now, and the address is checked here
// instead, so a typo is answered as a typo rather than reaching Resend and
// coming back as "we couldn't send your email".

const MAX_EMAIL_LENGTH = 254
const MAX_TEXT_LENGTH = 100

/**
 * The address to store and send to, or null if it is not one.
 *
 * Lowercased so that one person is one entry: the table's unique index is on
 * the raw text, and "Ada@Co.com" and "ada@co.com" would otherwise be two
 * signups, each with its own confirmation email.
 */
export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null
  // Deliberately permissive — one @, something on each side, a dot in the
  // domain, no whitespace. Resend is the real judge; this only catches the
  // mistakes a person would want to be told about before submitting.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

/** An optional free-text field: trimmed, capped, and empty when absent. */
export function cleanText(value: unknown, max = MAX_TEXT_LENGTH): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** The confirmation email's heading, safe to interpolate into HTML. */
export function confirmHeading(name: string): string {
  return name ? `Hi ${escapeHtml(name)}, confirm your spot 👋` : 'Hi there, confirm your spot 👋'
}

/** The welcome email's heading, safe to interpolate into HTML. */
export function welcomeHeading(name: string): string {
  return name ? `You're in, ${escapeHtml(name)}. 🎉` : "You're in. 🎉"
}
