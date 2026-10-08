// Where a saved workflow goes in the list the customer is looking at.
//
// Six lines, extracted from the component because it was inline and therefore
// unverifiable. A walkthrough edited the workflow that happened to be first
// already, so it stayed first whether this replaced in place or prepended —
// the observation could not tell the two apart, which makes it not a test.

/** The minimum a list entry needs for this to place it. */
type Identified = { id: string }

/**
 * Returns the list with `saved` in it: replaced where it already is, or added
 * at the front when it is new.
 *
 * Replacing in place rather than moving to the top is deliberate. The list is
 * ordered by creation date, so an edit that reordered it would move a workflow
 * away from where the customer just clicked Edit — and leave them checking
 * whether they changed the one they meant to.
 */
export function upsertWorkflow<T extends Identified>(list: readonly T[], saved: T): T[] {
  const at = list.findIndex((item) => item.id === saved.id)
  if (at === -1) return [saved, ...list]

  const next = [...list]
  next[at] = saved
  return next
}
