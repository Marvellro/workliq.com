import { isTestFingerprint } from './test-fingerprint'

// How a run's trigger is described in Activity, read back from the fingerprint
// it was recorded under. Kept out of the page component so it can be tested,
// and beside the fingerprint helper so the two are changed together.

export function describeTrigger(fingerprint: string, dealId: string): string {
  // Fingerprints are built by the engine as:
  //   deal_created        -> "<dealId>"
  //   deal_stage_changed  -> "<dealId>:<stage>"
  //   deal_stale          -> "<dealId>:<thresholdDays>"
  //   a test run          -> "test:<uuid>"
  //
  // Tests first, and explicitly. Anything unrecognised falls through to "Deal
  // created" below, so without this a test run would sit in a customer's
  // history described as a real event.
  if (isTestFingerprint(fingerprint)) return 'Test run'
  const suffix = fingerprint.startsWith(`${dealId}:`)
    ? fingerprint.slice(dealId.length + 1)
    : null
  if (!suffix) return 'Deal created'
  return /^\d+$/.test(suffix) ? `Stale ${suffix}+ days` : `Moved to ${suffix}`
}
