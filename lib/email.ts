import type { Resend, CreateEmailOptions } from 'resend'

// Sending an email, and knowing whether it went.
//
// Resend's SDK never throws. Every failure — a missing or revoked API key, an
// unverified sending domain, a rate limit, a rejected address, a network error
// — comes back as a resolved `{ data: null, error }`. The SDK catches its own
// exceptions to do it. So `await resend.emails.send(...)` succeeds whether or
// not anything was sent, and every caller in this codebase was treating a
// refused email as a delivered one:
//
//   - the customer digest stamped its items as reported, so a customer whose
//     email was refused was never told — and never would be;
//   - the operator alert recorded itself as sent, then suppressed itself for
//     24 hours;
//   - the waitlist told the person their confirmation was on its way.
//
// Two of those had comments saying the opposite ("recorded only after the
// send is accepted"). Found on 12 Nov 2026, verifying the AI-refusal alert,
// whose sent count could not prove an email had gone.
//
// Every send goes through here, which throws unless Resend accepted the email,
// so the try/catch each caller already had finally means what it says.

export class EmailNotSentError extends Error {
  /** Resend's error name, e.g. "validation_error" or "rate_limit_exceeded". */
  readonly code: string | null
  constructor(message: string, code: string | null) {
    super(message)
    this.name = 'EmailNotSentError'
    this.code = code
  }
}

/**
 * Sends one email and returns Resend's id for it. Throws EmailNotSentError
 * unless Resend accepted the email — including the case where it reports no
 * error but returns no id either, since an id is the only proof of acceptance.
 */
export async function sendEmail(resend: Resend, payload: CreateEmailOptions): Promise<string> {
  const { data, error } = await resend.emails.send(payload)
  if (error) throw new EmailNotSentError(error.message, error.name ?? null)
  if (!data?.id) throw new EmailNotSentError('Resend reported no error but returned no message id', null)
  return data.id
}
