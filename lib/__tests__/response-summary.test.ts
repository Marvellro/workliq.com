import { describe, it, expect } from 'vitest'
import { summariseResponseBody } from '../workflow-actions'

// This text lands in workflow_runs.error_message, which is what a customer
// reads in the activity feed at the moment something has broken. The previous
// code sliced the raw body to 500 characters whatever it was, so a 404 from any
// endpoint serving an HTML error page produced:
//
//   Step 2 (Call a webhook): Webhook returned 404: <!DOCTYPE html><html
//   lang="en" class="geist_a71539c9-module__T19VSG__variable …
//
// Found by deliberately failing a step during the multi-step walkthrough.

describe('summariseResponseBody', () => {
  it('drops an HTML error page entirely', () => {
    // The status code already carries the whole message. A de-tagged page is
    // just navigation text, so stripping tags would not help either.
    const page =
      '<!DOCTYPE html><html lang="en" class="geist_a71539c9-module__T19VSG__variable">' +
      '<head><meta charSet="utf-8"/></head><body><h1>404</h1></body></html>'
    expect(summariseResponseBody(page)).toBe('')
  })

  it('drops markup even with leading whitespace', () => {
    expect(summariseResponseBody('\n  <html><body>nope</body></html>')).toBe('')
    expect(summariseResponseBody('<?xml version="1.0"?><error/>')).toBe('')
  })

  it('keeps what an API actually says', () => {
    // The case the excerpt exists for.
    expect(summariseResponseBody('{"error":"invalid signature"}')).toBe(
      '{"error":"invalid signature"}'
    )
    expect(summariseResponseBody('invalid_token')).toBe('invalid_token')
  })

  it('collapses whitespace so one line of the feed stays one line', () => {
    expect(summariseResponseBody('{\n  "error":\n     "nope"\n}')).toBe('{ "error": "nope" }')
  })

  it('caps a long body and marks the cut', () => {
    const long = 'x'.repeat(500)
    const out = summariseResponseBody(long)
    expect(out).toHaveLength(201)
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns nothing for an empty body', () => {
    // The caller omits the colon entirely in this case, so the message reads
    // "Webhook returned 503" rather than trailing into nothing.
    expect(summariseResponseBody('')).toBe('')
    expect(summariseResponseBody('   \n ')).toBe('')
  })
})
