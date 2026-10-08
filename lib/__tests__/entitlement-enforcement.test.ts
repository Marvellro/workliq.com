import { describe, it, expect } from 'vitest'
import { decidePauses } from '../entitlement-enforcement'

// Which workflows survive a plan limit. The rule has to be stated in one
// sentence to a customer who just lost something, and it has to be stable —
// a repeated Stripe webhook must not pause a different set the second time.

function w(id: string, created: string) {
  return { id, created_at: created }
}

const first = w('a', '2026-01-01T00:00:00Z')
const second = w('b', '2026-02-01T00:00:00Z')
const third = w('c', '2026-03-01T00:00:00Z')

describe('decidePauses', () => {
  it('keeps nothing paused when the account is within its limit', () => {
    expect(decidePauses([first, second], 10)).toEqual({ keep: ['a', 'b'], pause: [] })
  })

  it('keeps the oldest and pauses the rest', () => {
    // "We kept the first N you built" is the sentence this has to support.
    expect(decidePauses([third, first, second], 1)).toEqual({
      keep: ['a'],
      pause: ['b', 'c'],
    })
  })

  it('does not depend on the order it receives them in', () => {
    const forwards = decidePauses([first, second, third], 2)
    const backwards = decidePauses([third, second, first], 2)
    expect(forwards).toEqual(backwards)
    expect(forwards.keep).toEqual(['a', 'b'])
  })

  it('breaks a timestamp tie deterministically', () => {
    // Two workflows created in the same millisecond must not resolve
    // differently between runs — otherwise a retried webhook pauses a
    // different one and the customer sees it flap.
    const x = w('x', '2026-01-01T00:00:00Z')
    const y = w('y', '2026-01-01T00:00:00Z')
    expect(decidePauses([x, y], 1)).toEqual(decidePauses([y, x], 1))
    expect(decidePauses([y, x], 1).keep).toEqual(['x'])
  })

  it('pauses everything when the limit is zero', () => {
    expect(decidePauses([first, second], 0)).toEqual({ keep: [], pause: ['a', 'b'] })
  })

  it('treats a negative limit as zero rather than slicing from the end', () => {
    // Math.max guards this: slice(-1) would otherwise keep the NEWEST workflow
    // and pause the rest, which is the opposite of the rule.
    expect(decidePauses([first, second, third], -1)).toEqual({
      keep: [],
      pause: ['a', 'b', 'c'],
    })
  })

  it('handles an account with nothing enabled', () => {
    expect(decidePauses([], 1)).toEqual({ keep: [], pause: [] })
  })
})
