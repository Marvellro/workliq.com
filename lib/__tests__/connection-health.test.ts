import { describe, it, expect } from 'vitest'
import {
  ConnectionError,
  hubspotRefreshFailure,
  hubspotApiFailure,
  slackWebhookFailure,
  notionFailure,
} from '../connection-health'

// These classifiers decide whether a customer gets told "reconnect HubSpot".
// Both directions of mistake are expensive and they are not symmetric:
//
//   false negative — we keep retrying a dead credential and the customer is
//                    never told. This is the bug that exists today.
//   false positive — we tell a customer their working connection is broken.
//                    Worse, because the most likely cause of a false positive
//                    is OUR misconfiguration, which fails for every customer at
//                    once and would email the entire base at once.
//
// So the our-fault exclusions get as much coverage as the detections.

const CUSTOMER = '11111111-2222-3333-4444-555555555555'

describe('ConnectionError', () => {
  it('carries the provider and customer so the failure has an owner', () => {
    const err = new ConnectionError({
      provider: 'slack',
      customerId: CUSTOMER,
      message: 'Reconnect Slack.',
    })
    expect(err.provider).toBe('slack')
    expect(err.customerId).toBe(CUSTOMER)
  })

  it('is an Error, so an untouched call site still behaves', () => {
    // Every existing `catch (err)` predates this class. Throwing something that
    // isn't an Error would break the `err instanceof Error ? err.message` that
    // the queue and both crons use to log.
    const err = new ConnectionError({ provider: 'notion', customerId: CUSTOMER, message: 'x' })
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('x')
  })

  it('truncates the stored detail', () => {
    // Provider bodies can be arbitrarily long; this lands in a text column and
    // is shown to support.
    const err = new ConnectionError({
      provider: 'hubspot',
      customerId: CUSTOMER,
      message: 'short',
      detail: 'x'.repeat(5000),
    })
    expect(err.detail.length).toBe(500)
  })

  it('falls back to the message when no detail is given', () => {
    const err = new ConnectionError({ provider: 'hubspot', customerId: CUSTOMER, message: 'only' })
    expect(err.detail).toBe('only')
  })
})

describe('hubspotRefreshFailure', () => {
  it('treats a dead refresh token as a connection failure', () => {
    // The real body HubSpot returns once the app is uninstalled.
    const body = '{"status":"BAD_REFRESH_TOKEN","message":"missing or unknown refresh token"}'
    const err = hubspotRefreshFailure(CUSTOMER, 400, body)
    expect(err).toBeInstanceOf(ConnectionError)
    expect(err?.provider).toBe('hubspot')
  })

  it('recognises the RFC 6749 spelling too', () => {
    expect(hubspotRefreshFailure(CUSTOMER, 400, '{"error":"invalid_grant"}')).toBeInstanceOf(
      ConnectionError
    )
  })

  it('does NOT blame the customer for our own client credentials', () => {
    // This is the case that matters most. A wrong client secret or redirect URI
    // fails identically for every customer simultaneously. Classifying it as a
    // dead grant would mark the whole customer base needs_reauth over an
    // environment variable — and this codebase has already shipped an
    // apex-vs-www redirect_uri bug once.
    for (const body of [
      '{"error":"invalid_client"}',
      '{"status":"BAD_CLIENT_ID","message":"..."}',
      '{"status":"BAD_CLIENT_SECRET"}',
      '{"status":"BAD_REDIRECT_URI","message":"redirect uri mismatch"}',
      '{"status":"BAD_GRANT_TYPE"}',
    ]) {
      expect(hubspotRefreshFailure(CUSTOMER, 400, body)).toBeNull()
      expect(hubspotRefreshFailure(CUSTOMER, 401, body)).toBeNull()
    }
  })

  it('leaves transient failures alone', () => {
    // These must keep retrying — that is what the queue's backoff is for.
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(hubspotRefreshFailure(CUSTOMER, status, 'upstream unavailable')).toBeNull()
    }
  })

  it('tells the customer what to do rather than quoting the API', () => {
    const err = hubspotRefreshFailure(CUSTOMER, 400, '{"status":"BAD_REFRESH_TOKEN"}')
    expect(err?.message).toMatch(/reconnect HubSpot/i)
    // The raw body belongs in detail, not in the sentence the customer reads.
    expect(err?.message).not.toMatch(/BAD_REFRESH_TOKEN/)
    expect(err?.detail).toMatch(/BAD_REFRESH_TOKEN/)
  })
})

describe('hubspotApiFailure', () => {
  it('flags a rejected token', () => {
    expect(hubspotApiFailure(CUSTOMER, 401, 'expired')).toBeInstanceOf(ConnectionError)
  })

  it('flags a missing scope, which only reconnecting can grant', () => {
    const err = hubspotApiFailure(CUSTOMER, 403, '{"message":"required scope missing"}')
    expect(err).toBeInstanceOf(ConnectionError)
    expect(err?.message).toMatch(/permission/i)
  })

  it('ignores everything else', () => {
    // 404 in particular: a deleted deal is routine and must never be read as a
    // broken connection.
    for (const status of [400, 404, 409, 429, 500, 503]) {
      expect(hubspotApiFailure(CUSTOMER, status, 'body')).toBeNull()
    }
  })
})

describe('slackWebhookFailure', () => {
  it('flags a revoked webhook', () => {
    for (const body of ['invalid_token', 'no_active_hooks', 'no_service', 'no_team']) {
      expect(slackWebhookFailure(CUSTOMER, 403, body)).toBeInstanceOf(ConnectionError)
    }
  })

  it('names the channel case separately', () => {
    // The customer's instinct on "Slack connection broken" is to look at app
    // settings. If the channel was archived, that search finds nothing wrong.
    for (const body of ['channel_not_found', 'channel_is_archived']) {
      const err = slackWebhookFailure(CUSTOMER, 404, body)
      expect(err?.message).toMatch(/channel/i)
    }
  })

  it('does NOT flag our own malformed payloads', () => {
    // invalid_payload means the JSON we built is wrong. Telling the customer to
    // reconnect would send them to fix a bug in our code.
    expect(slackWebhookFailure(CUSTOMER, 400, 'invalid_payload')).toBeNull()
    expect(slackWebhookFailure(CUSTOMER, 400, 'too_many_attachments')).toBeNull()
  })

  it('does NOT flag Slack-side errors', () => {
    // Slack documents rollup_error as likely not the caller's fault.
    expect(slackWebhookFailure(CUSTOMER, 500, 'rollup_error')).toBeNull()
    expect(slackWebhookFailure(CUSTOMER, 503, 'service unavailable')).toBeNull()
  })

  it('lets an our-fault body win over a dead-looking status', () => {
    // Precedence check: 403 alone would flag, but an invalid_payload body means
    // the request was wrong, whatever status came back with it.
    expect(slackWebhookFailure(CUSTOMER, 403, 'invalid_payload')).toBeNull()
  })

  it('flags an unrecognised body on a 403 or 404', () => {
    // Slack's error vocabulary is not fixed. A 403/404 we can't name is still
    // far more likely to be a dead webhook than a transient blip.
    expect(slackWebhookFailure(CUSTOMER, 403, 'something_new')).toBeInstanceOf(ConnectionError)
    expect(slackWebhookFailure(CUSTOMER, 404, '')).toBeInstanceOf(ConnectionError)
  })
})

describe('notionFailure', () => {
  it('flags a revoked token and a lost page', () => {
    expect(notionFailure(CUSTOMER, 401, '{"code":"unauthorized"}')).toBeInstanceOf(ConnectionError)
    expect(notionFailure(CUSTOMER, 403, '{"code":"restricted_resource"}')).toBeInstanceOf(
      ConnectionError
    )
  })

  it('treats a deleted database as needing a reconnect, not a retry', () => {
    // 404 reads as transient and is terminal: the database we write into is
    // gone, and only reconnecting recreates it.
    const err = notionFailure(CUSTOMER, 404, '{"code":"object_not_found"}')
    expect(err).toBeInstanceOf(ConnectionError)
    expect(err?.message).toMatch(/database/i)
  })

  it('leaves rate limits and outages to the retry logic', () => {
    for (const status of [409, 429, 500, 502, 503]) {
      expect(notionFailure(CUSTOMER, status, 'body')).toBeNull()
    }
  })
})
