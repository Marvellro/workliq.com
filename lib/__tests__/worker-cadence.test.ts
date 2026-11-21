import { describe, it, expect } from 'vitest'
import { sweepIsDue, SWEEP_INTERVAL_MS } from '../worker-cadence'

// The worker is called every minute; its sweeps must not be. Running all of
// them on every call was ~23,000 requests a day against a shared egress quota.
// Skipping them when they ARE due would be worse: a digest or an operator alert
// that silently never runs.

const T = Date.UTC(2026, 10, 18, 9, 0, 0)
const MINUTE = 60_000

describe('sweepIsDue', () => {
  it('sweeps on an instance that never has', () => {
    // A fresh instance cannot know when the last sweep happened anywhere, so
    // it must not assume one did.
    expect(sweepIsDue(null, T)).toBe(true)
  })

  it('skips the calls in between', () => {
    for (const m of [1, 2, 7, 14]) expect(sweepIsDue(T, T + m * MINUTE)).toBe(false)
  })

  it('sweeps again once the interval has passed', () => {
    expect(sweepIsDue(T, T + SWEEP_INTERVAL_MS)).toBe(true)
    expect(sweepIsDue(T, T + 3 * 60 * MINUTE)).toBe(true)
  })

  it('is fifteen minutes', () => {
    expect(SWEEP_INTERVAL_MS).toBe(15 * MINUTE)
  })

  it('sweeps rather than waits when the clock has moved backwards', () => {
    expect(sweepIsDue(T, T - 5 * MINUTE)).toBe(true)
  })

  it('cuts a day of per-minute calls to about one sweep per interval', () => {
    // Simulates the pinger: one call a minute for a day on one warm instance.
    let last: number | null = null
    let sweeps = 0
    for (let m = 0; m < 24 * 60; m++) {
      const now = T + m * MINUTE
      if (sweepIsDue(last, now)) {
        sweeps++
        last = now
      }
    }
    expect(sweeps).toBe(96)
  })
})
