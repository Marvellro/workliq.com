import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import {
  verifyHubSpotSignature,
  buildSignedUri,
  parseWebhookBatch,
} from '../hubspot-signature'

const SECRET = 'EXAMPLE-app-client-secret'
const URI = 'https://www.workliq.com/api/webhooks/hubspot'
const BODY = JSON.stringify([
  {
    eventId: 1,
    portalId: 12345,
    occurredAt: 1_700_000_000_000,
    subscriptionType: 'deal.propertyChange',
    objectId: 999,
    propertyName: 'dealstage',
    propertyValue: 'closedwon',
  },
])

// Signs exactly as HubSpot documents: method + uri + body + timestamp,
// HMAC-SHA256 keyed on the client secret, base64.
function sign(body: string, timestamp: string, secret = SECRET, uri = URI, method = 'POST') {
  return createHmac('sha256', secret)
    .update(`${method}${uri}${body}${timestamp}`, 'utf8')
    .digest('base64')
}

const NOW = 1_700_000_000_000
const TS = String(NOW)

describe('verifyHubSpotSignature', () => {
  it('accepts a correctly signed request', () => {
    const result = verifyHubSpotSignature({
      method: 'POST',
      uri: URI,
      body: BODY,
      signature: sign(BODY, TS),
      timestamp: TS,
      clientSecret: SECRET,
      now: NOW,
    })
    expect(result.valid).toBe(true)
  })

  it('rejects a request signed with the wrong secret', () => {
    const result = verifyHubSpotSignature({
      method: 'POST',
      uri: URI,
      body: BODY,
      signature: sign(BODY, TS, 'attacker-secret'),
      timestamp: TS,
      clientSecret: SECRET,
      now: NOW,
    })
    expect(result).toEqual({ valid: false, reason: 'signature mismatch' })
  })

  it('rejects a tampered body', () => {
    // The exact attack this guard exists for: a valid signature captured from
    // one delivery, replayed with a payload naming a different deal.
    const signature = sign(BODY, TS)
    const tampered = BODY.replace('"objectId":999', '"objectId":111')
    const result = verifyHubSpotSignature({
      method: 'POST',
      uri: URI,
      body: tampered,
      signature,
      timestamp: TS,
      clientSecret: SECRET,
      now: NOW,
    })
    expect(result.valid).toBe(false)
  })

  it('rejects when the signed URI differs', () => {
    const result = verifyHubSpotSignature({
      method: 'POST',
      uri: 'https://www.workliq.com/api/webhooks/hubspot?injected=1',
      body: BODY,
      signature: sign(BODY, TS),
      timestamp: TS,
      clientSecret: SECRET,
      now: NOW,
    })
    expect(result.valid).toBe(false)
  })

  it('rejects when the method differs', () => {
    const result = verifyHubSpotSignature({
      method: 'PUT',
      uri: URI,
      body: BODY,
      signature: sign(BODY, TS),
      timestamp: TS,
      clientSecret: SECRET,
      now: NOW,
    })
    expect(result.valid).toBe(false)
  })

  it('rejects a replay older than five minutes', () => {
    const signature = sign(BODY, TS)
    const sixMinutesLater = NOW + 6 * 60 * 1000
    const result = verifyHubSpotSignature({
      method: 'POST',
      uri: URI,
      body: BODY,
      signature,
      timestamp: TS,
      clientSecret: SECRET,
      now: sixMinutesLater,
    })
    expect(result).toEqual({ valid: false, reason: 'timestamp outside the 5 minute window' })
  })

  it('accepts a request four minutes old', () => {
    const result = verifyHubSpotSignature({
      method: 'POST',
      uri: URI,
      body: BODY,
      signature: sign(BODY, TS),
      timestamp: TS,
      clientSecret: SECRET,
      now: NOW + 4 * 60 * 1000,
    })
    expect(result.valid).toBe(true)
  })

  it('rejects a future-dated timestamp', () => {
    // Left unchecked, a forged-ahead timestamp would keep a captured request
    // replayable for as long as the attacker chose.
    const future = String(NOW + 60 * 60 * 1000)
    const result = verifyHubSpotSignature({
      method: 'POST',
      uri: URI,
      body: BODY,
      signature: sign(BODY, future),
      timestamp: future,
      clientSecret: SECRET,
      now: NOW,
    })
    expect(result.valid).toBe(false)
  })

  it('rejects missing headers rather than throwing', () => {
    const base = { method: 'POST', uri: URI, body: BODY, clientSecret: SECRET, now: NOW }
    expect(verifyHubSpotSignature({ ...base, signature: null, timestamp: TS })).toEqual({
      valid: false,
      reason: 'missing signature header',
    })
    expect(verifyHubSpotSignature({ ...base, signature: sign(BODY, TS), timestamp: null })).toEqual({
      valid: false,
      reason: 'missing timestamp header',
    })
  })

  it('rejects malformed signatures without throwing', () => {
    // timingSafeEqual throws on length mismatch, so a short or junk signature
    // must be length-checked first or it crashes the endpoint.
    const base = { method: 'POST', uri: URI, body: BODY, clientSecret: SECRET, now: NOW, timestamp: TS }
    for (const signature of ['', 'AA==', 'not-base64-!!!', 'x'.repeat(500)]) {
      expect(() => verifyHubSpotSignature({ ...base, signature })).not.toThrow()
      expect(verifyHubSpotSignature({ ...base, signature }).valid).toBe(false)
    }
  })

  it('rejects a non-numeric timestamp', () => {
    const result = verifyHubSpotSignature({
      method: 'POST',
      uri: URI,
      body: BODY,
      signature: sign(BODY, 'abc'),
      timestamp: 'abc',
      clientSecret: SECRET,
      now: NOW,
    })
    expect(result).toEqual({ valid: false, reason: 'timestamp is not a number' })
  })
})

describe('buildSignedUri', () => {
  it('joins origin, path and query', () => {
    expect(buildSignedUri('https://www.workliq.com', '/api/webhooks/hubspot', '')).toBe(
      'https://www.workliq.com/api/webhooks/hubspot'
    )
    expect(buildSignedUri('https://www.workliq.com', '/api/webhooks/hubspot', '?a=1')).toBe(
      'https://www.workliq.com/api/webhooks/hubspot?a=1'
    )
  })

  it('tolerates a trailing slash on the origin', () => {
    expect(buildSignedUri('https://www.workliq.com/', '/api/webhooks/hubspot', '')).toBe(
      'https://www.workliq.com/api/webhooks/hubspot'
    )
  })

  it('decodes %3A and %2F as the spec requires', () => {
    // HubSpot decodes these before signing; leaving them encoded produces a
    // signature that never matches for any URL containing them.
    expect(buildSignedUri('https://www.workliq.com', '/api/webhooks/hubspot', '?u=a%3A%2Fb')).toBe(
      'https://www.workliq.com/api/webhooks/hubspot?u=a:/b'
    )
  })
})

describe('parseWebhookBatch', () => {
  it('parses a well-formed batch', () => {
    const events = parseWebhookBatch(BODY)
    expect(events).toHaveLength(1)
    expect(events[0].subscriptionType).toBe('deal.propertyChange')
  })

  it('returns empty for invalid JSON or a non-array', () => {
    expect(parseWebhookBatch('not json')).toEqual([])
    expect(parseWebhookBatch('{"not":"an array"}')).toEqual([])
    expect(parseWebhookBatch('')).toEqual([])
  })

  it('drops malformed entries but keeps valid ones', () => {
    // One odd event must not cost us the whole batch — rejecting the delivery
    // would make HubSpot retry every event in it, forever.
    const mixed = JSON.stringify([
      { portalId: 1, subscriptionType: 'deal.creation', objectId: 5, occurredAt: 1 },
      { missing: 'everything' },
      null,
      'a string',
      { portalId: 2, subscriptionType: 'deal.creation', objectId: 6, occurredAt: 2 },
    ])
    expect(parseWebhookBatch(mixed)).toHaveLength(2)
  })

  it('accepts a string objectId', () => {
    const body = JSON.stringify([
      { portalId: 1, subscriptionType: 'deal.creation', objectId: '12345', occurredAt: 1 },
    ])
    expect(parseWebhookBatch(body)).toHaveLength(1)
  })
})
