import { describe, it, expect } from 'vitest'
import { upsertWorkflow } from '../workflow-list'

const a = { id: 'a', name: 'First' }
const b = { id: 'b', name: 'Second' }
const c = { id: 'c', name: 'Third' }

describe('upsertWorkflow', () => {
  it('adds a new workflow at the front', () => {
    expect(upsertWorkflow([a, b], { id: 'new', name: 'New' })).toEqual([
      { id: 'new', name: 'New' },
      a,
      b,
    ])
  })

  it('replaces an edited workflow without moving it', () => {
    // The case a production walkthrough could not distinguish: the workflow
    // edited there was already first, so it stayed first either way. Here the
    // edited one is in the middle, where prepending would be visible.
    const edited = { id: 'b', name: 'Second, edited' }
    expect(upsertWorkflow([a, b, c], edited)).toEqual([a, edited, c])
  })

  it('keeps the last entry last', () => {
    const edited = { id: 'c', name: 'Third, edited' }
    expect(upsertWorkflow([a, b, c], edited)).toEqual([a, b, edited])
  })

  it('does not mutate the list it was given', () => {
    // React compares by reference; mutating in place would leave the screen
    // showing the old value until something else forced a render.
    const original = [a, b, c]
    const result = upsertWorkflow(original, { id: 'b', name: 'changed' })
    expect(original).toEqual([a, b, c])
    expect(result).not.toBe(original)
  })

  it('handles an empty list', () => {
    expect(upsertWorkflow([], a)).toEqual([a])
  })
})
