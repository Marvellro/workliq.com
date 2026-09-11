/**
 * One-shot backfill: encrypts credential columns that are still plaintext.
 *
 * Run AFTER deploying the code that reads encrypted values, not before. The
 * order matters and only one direction is safe:
 *
 *   decrypt() passes plaintext through unchanged, so new code reads old rows
 *   fine. Old code cannot read encrypted rows at all. Deploy first, backfill
 *   second, and there is never a moment where the running code can't read the
 *   database.
 *
 * Idempotent: rows already in envelope form are skipped, so re-running after a
 * partial failure is safe.
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-encryption.ts          # dry run
 *   node --env-file=.env.local scripts/backfill-encryption.ts --apply  # write
 */

import { createClient } from '@supabase/supabase-js'
import { encrypt, decrypt, isEncrypted } from '../lib/crypto.ts'

const APPLY = process.argv.includes('--apply')

const TARGETS = [
  { table: 'hubspot_connections', columns: ['access_token', 'refresh_token'] },
  { table: 'slack_connections', columns: ['access_token', 'webhook_url'] },
  { table: 'notion_connections', columns: ['access_token'] },
] as const

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Run with: node --env-file=.env.local scripts/backfill-encryption.ts'
    )
    process.exit(1)
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

async function main() {
  if (!process.env.WORKLIQ_ENCRYPTION_KEY) {
    console.error('WORKLIQ_ENCRYPTION_KEY is not set. Generate one with:')
    console.error('  openssl rand -base64 32')
    process.exit(1)
  }

  const supabase = client()
  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to write) ===\n')

  let totalPlaintext = 0
  let totalUpdated = 0

  for (const { table, columns } of TARGETS) {
    const { data: rows, error } = await supabase
      .from(table)
      .select(['id', ...columns].join(','))

    if (error) {
      console.error(`  ${table}: read failed — ${error.message}`)
      process.exitCode = 1
      continue
    }

    const list = (rows ?? []) as unknown as Record<string, string>[]
    console.log(`${table}: ${list.length} row(s)`)

    for (const row of list) {
      const update: Record<string, string> = {}

      for (const col of columns) {
        const value = row[col]
        if (typeof value !== 'string' || value.length === 0) continue
        if (isEncrypted(value)) continue
        update[col] = encrypt(value)
        totalPlaintext++
      }

      if (Object.keys(update).length === 0) {
        console.log(`  ${row.id}: already encrypted — skipped`)
        continue
      }

      // Verify before writing. Encrypting and storing a value we cannot read
      // back would lock the customer out of their own integration with no way
      // to recover short of reconnecting.
      for (const [col, envelope] of Object.entries(update)) {
        if (decrypt(envelope) !== row[col]) {
          console.error(`  ${row.id}: round-trip check FAILED for ${col} — aborting`)
          process.exit(1)
        }
      }

      if (!APPLY) {
        console.log(`  ${row.id}: would encrypt ${Object.keys(update).join(', ')}`)
        continue
      }

      const { error: updateError } = await supabase
        .from(table)
        .update(update)
        .eq('id', row.id)

      if (updateError) {
        console.error(`  ${row.id}: update failed — ${updateError.message}`)
        process.exitCode = 1
      } else {
        console.log(`  ${row.id}: encrypted ${Object.keys(update).join(', ')}`)
        totalUpdated++
      }
    }
  }

  console.log(
    `\n${totalPlaintext} plaintext value(s) found; ${APPLY ? `${totalUpdated} row(s) updated` : 'no changes written'}`
  )

  if (APPLY && totalUpdated > 0) {
    console.log(
      '\nNext: confirm the integrations still work (Slack/Notion test buttons in\n' +
        'the dashboard), then the legacy-plaintext passthrough in lib/crypto.ts\n' +
        'decrypt() can be replaced with a throw.'
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
