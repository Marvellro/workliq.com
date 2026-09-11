import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'crypto'
import {
  encrypt,
  decrypt,
  isEncrypted,
  signWebhookPayload,
  verifyWebhookSignature,
  generateWebhookSecret,
  __setKeysForTesting,
} from '../crypto'

const TEST_KEY = randomBytes(32)

beforeEach(() => {
  __setKeysForTesting(new Map([[1, TEST_KEY]]))
})

afterEach(() => {
  __setKeysForTesting(null)
})

describe('encrypt / decrypt', () => {
  it('round-trips a value', () => {
    // Fixtures here are deliberately NOT shaped like real credentials.
    // A fixture that imitates a provider's real token format trips GitHub's
    // push protection and, worse, trains reviewers to skim past
    // credential-shaped strings in diffs.
    const token = 'EXAMPLE-not-a-real-token-0000'
    expect(decrypt(encrypt(token))).toBe(token)
  })

  it('round-trips unicode and empty strings', () => {
    for (const value of ['', 'ünïcodé 🎉 tokens', 'a'.repeat(5000)]) {
      expect(decrypt(encrypt(value))).toBe(value)
    }
  })

  it('produces different ciphertext for the same plaintext', () => {
    // A fresh IV per call. Without this, identical stored values would be
    // visibly identical — an attacker reading the table could tell which
    // customers share a webhook URL.
    const a = encrypt('same-value')
    const b = encrypt('same-value')
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe(decrypt(b))
  })

  it('emits a version-prefixed envelope', () => {
    const out = encrypt('x')
    expect(out.startsWith('v1:')).toBe(true)
    expect(out.split(':')).toHaveLength(4)
    expect(isEncrypted(out)).toBe(true)
  })

  it('never leaks plaintext into the envelope', () => {
    const secret = 'EXAMPLE-sensitive-value'
    expect(encrypt(secret)).not.toContain(secret)
  })
})

describe('decrypt tamper detection', () => {
  it('rejects a modified ciphertext', () => {
    const envelope = encrypt('original-token')
    const [v, iv, tag, ct] = envelope.split(':')

    // Flip a bit in the ciphertext body.
    const buf = Buffer.from(ct, 'base64')
    buf[0] ^= 0xff
    const tampered = [v, iv, tag, buf.toString('base64')].join(':')

    // GCM authenticates, so this must throw rather than return garbage. If it
    // returned corrupted plaintext, a tampered row could silently redirect a
    // customer's alerts to an attacker-controlled endpoint.
    expect(() => decrypt(tampered)).toThrow()
  })

  it('rejects a modified auth tag', () => {
    const envelope = encrypt('original-token')
    const [v, iv, tag, ct] = envelope.split(':')
    const buf = Buffer.from(tag, 'base64')
    buf[0] ^= 0xff
    expect(() => decrypt([v, iv, buf.toString('base64'), ct].join(':'))).toThrow()
  })

  it('rejects ciphertext encrypted under a different key', () => {
    const envelope = encrypt('original-token')
    __setKeysForTesting(new Map([[1, randomBytes(32)]]))
    expect(() => decrypt(envelope)).toThrow()
  })
})

describe('decrypt migration path', () => {
  it('passes through legacy plaintext unchanged', () => {
    // Rows written before encryption shipped are still plaintext. The live
    // cron must keep working while the backfill runs.
    expect(decrypt('https://example.invalid/EXAMPLE-webhook-path')).toBe(
      'https://example.invalid/EXAMPLE-webhook-path'
    )
  })

  it('does not mistake arbitrary colon-separated text for an envelope', () => {
    expect(isEncrypted('not:an:envelope:value')).toBe(false)
    expect(decrypt('not:an:envelope:value')).toBe('not:an:envelope:value')
  })
})

describe('key rotation', () => {
  it('decrypts old-version rows using the retained old key', () => {
    const oldKey = randomBytes(32)
    __setKeysForTesting(new Map([[1, oldKey]]))
    const envelope = encrypt('token-under-v1')

    // Simulate rotation: a new primary key is in place, the old one retained.
    const newKey = randomBytes(32)
    __setKeysForTesting(new Map([[1, oldKey], [2, newKey]]))

    expect(decrypt(envelope)).toBe('token-under-v1')
  })

  it('throws a clear error when the key for that version is missing', () => {
    const envelope = encrypt('x').replace(/^v1:/, 'v7:')
    expect(() => decrypt(envelope)).toThrow(/WORKLIQ_ENCRYPTION_KEY_V7/)
  })
})

describe('webhook signing', () => {
  const secret = 'EXAMPLE-signing-secret'
  const body = JSON.stringify({ deal_id: '123', stage: 'closedwon' })

  it('verifies a signature it produced', () => {
    const { timestamp, signature } = signWebhookPayload(secret, body)
    expect(verifyWebhookSignature(secret, body, timestamp, signature)).toBe(true)
  })

  it('rejects a signature made with a different secret', () => {
    const { timestamp, signature } = signWebhookPayload('other-secret', body)
    expect(verifyWebhookSignature(secret, body, timestamp, signature)).toBe(false)
  })

  it('rejects a modified body', () => {
    const { timestamp, signature } = signWebhookPayload(secret, body)
    const tampered = JSON.stringify({ deal_id: '123', stage: 'closedlost' })
    expect(verifyWebhookSignature(secret, tampered, timestamp, signature)).toBe(false)
  })

  it('rejects a replayed request outside the tolerance window', () => {
    const now = Date.now()
    const { timestamp, signature } = signWebhookPayload(secret, body, now)
    // Same valid signature, replayed 10 minutes later.
    const later = now + 10 * 60 * 1000
    expect(verifyWebhookSignature(secret, body, timestamp, signature, 300, later)).toBe(false)
    // Still fine inside the window.
    expect(verifyWebhookSignature(secret, body, timestamp, signature, 300, now + 60_000)).toBe(true)
  })

  it('rejects a timestamp from the future', () => {
    const now = Date.now()
    const { timestamp, signature } = signWebhookPayload(secret, body, now + 10 * 60 * 1000)
    // A forged-ahead timestamp would otherwise extend a captured request's
    // usable replay window.
    expect(verifyWebhookSignature(secret, body, timestamp, signature, 300, now)).toBe(false)
  })

  it('rejects malformed signatures without throwing', () => {
    const { timestamp } = signWebhookPayload(secret, body)
    // timingSafeEqual throws on length mismatch — the implementation must
    // length-check first or a short signature crashes the request.
    expect(verifyWebhookSignature(secret, body, timestamp, 'ab')).toBe(false)
    expect(verifyWebhookSignature(secret, body, timestamp, '')).toBe(false)
    expect(verifyWebhookSignature(secret, body, 'not-a-number', 'abcd')).toBe(false)
  })

  it('generates distinct, prefixed secrets', () => {
    const a = generateWebhookSecret()
    const b = generateWebhookSecret()
    expect(a).toMatch(/^wlq_whsec_[0-9a-f]{48}$/)
    expect(a).not.toBe(b)
  })
})
