// The identity a test run is recorded under.
//
// Every step of every run claims a row in workflow_runs keyed on
// (workflow, deal, trigger fingerprint, step index), and that claim is what
// stops a step being delivered twice. Real fingerprints are built from the
// HubSpot deal ID — "<dealId>", "<dealId>:<stage>", "<dealId>:<days>" — and
// HubSpot deal IDs are numeric, so nothing real can ever begin with "test:".
//
// That separation is not cosmetic. A test that borrowed a real event's
// fingerprint would claim the real event's rows, and when the real event later
// arrived its steps would be skipped as already delivered: the test would have
// silently eaten the customer's alert.
//
// Imports nothing, so the Activity page can use it in the browser to label
// test runs as tests rather than mistaking them for real events.

export const TEST_FINGERPRINT_PREFIX = 'test:'

export function isTestFingerprint(fingerprint: string): boolean {
  return fingerprint.startsWith(TEST_FINGERPRINT_PREFIX)
}
