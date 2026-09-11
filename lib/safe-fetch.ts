import { lookup } from 'dns/promises'
import { isIP } from 'net'

// Guarded outbound HTTP for customer-controlled URLs (the `webhook` workflow
// action). Without this, a customer can point a workflow at any address our
// server can reach and use Workliq as a proxy into infrastructure they have no
// access to — the classic SSRF shape:
//
//   http://169.254.169.254/...     cloud instance metadata / credentials
//   http://127.0.0.1:8080/...      admin interfaces bound to loopback
//   http://10.0.0.5/...            anything else inside the VPC
//
// Requiring `https://` at the API layer (as app/api/workflows/route.ts does)
// stops none of these: `https://169.254.169.254` satisfies it perfectly.

const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 64 * 1024 // we only read enough to log an error

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedAddressError'
  }
}

// ── Address classification ───────────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    // Reject non-canonical octets ("01", "0x7f", "") — some resolvers and HTTP
    // clients accept them, and they're a common way to smuggle 127.0.0.1 past
    // a naive string check.
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    value = value * 256 + n
  }
  return value
}

function isBlockedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip)
  if (value === null) return true // unparseable — fail closed

  const inRange = (cidrBase: string, maskBits: number): boolean => {
    const base = ipv4ToInt(cidrBase)!
    const mask = maskBits === 0 ? 0 : (-1 << (32 - maskBits)) >>> 0
    return (value & mask) >>> 0 === (base & mask) >>> 0
  }

  return (
    inRange('0.0.0.0', 8) ||        // "this network"
    inRange('10.0.0.0', 8) ||       // RFC1918 private
    inRange('100.64.0.0', 10) ||    // RFC6598 carrier-grade NAT
    inRange('127.0.0.0', 8) ||      // loopback
    inRange('169.254.0.0', 16) ||   // link-local — includes cloud metadata
    inRange('172.16.0.0', 12) ||    // RFC1918 private
    inRange('192.0.0.0', 24) ||     // IETF protocol assignments
    inRange('192.168.0.0', 16) ||   // RFC1918 private
    inRange('198.18.0.0', 15) ||    // benchmarking
    inRange('224.0.0.0', 4) ||      // multicast
    inRange('240.0.0.0', 4)         // reserved, includes 255.255.255.255
  )
}

function isBlockedIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0] // strip any zone index

  if (addr === '::' || addr === '::1') return true // unspecified, loopback

  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms must be judged by
  // their embedded IPv4 address, or loopback walks straight through.
  const mapped = /^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr)
  if (mapped) return isBlockedIPv4(mapped[1])

  return (
    addr.startsWith('fe80') || // link-local
    addr.startsWith('fc') ||   // unique local
    addr.startsWith('fd') ||   // unique local
    addr.startsWith('ff')      // multicast
  )
}

/** True if this literal IP must never be contacted on a customer's behalf. */
export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isBlockedIPv4(ip)
  if (version === 6) return isBlockedIPv6(ip)
  return true // not an IP at all — fail closed
}

// ── URL validation ───────────────────────────────────────────────────────────

/**
 * Validates a customer-supplied webhook URL at save time.
 *
 * This is a usability check, not the security boundary — DNS can change between
 * saving a workflow and running it (a hostname that resolved to a public IP at
 * save time can be repointed at 127.0.0.1 later). `safeFetch` re-resolves on
 * every request, and that is what actually enforces the policy.
 */
export async function validateWebhookUrl(rawUrl: string): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new BlockedAddressError('Webhook URL is not a valid URL')
  }

  if (url.protocol !== 'https:') {
    throw new BlockedAddressError('Webhook URL must use https')
  }

  // Credentials in the URL would be logged and echoed back in errors.
  if (url.username || url.password) {
    throw new BlockedAddressError('Webhook URL must not contain credentials')
  }

  await assertResolvesToPublicAddress(url.hostname)
}

async function assertResolvesToPublicAddress(hostname: string): Promise<void> {
  // `new URL('https://[::1]/').hostname` returns "[::1]" — brackets included —
  // and isIP() rejects that, so an IPv6 literal would fall through to the DNS
  // path instead of being recognised as an address. It happens to fail closed
  // there (the lookup errors), but only by accident: a resolver that answered
  // for the bracketed string would let ::1 straight through. Strip them so the
  // literal is checked as an address, deliberately.
  const host = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname

  // A bare IP literal never goes to DNS — check it directly.
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new BlockedAddressError(
        `Webhook URL resolves to a non-public address (${host})`
      )
    }
    return
  }

  let addresses: { address: string }[]
  try {
    // `all: true` because a hostname can resolve to several addresses and an
    // attacker only needs one of them to be internal. Checking just the first
    // would let a record with one public and one private A record through.
    addresses = await lookup(host, { all: true })
  } catch {
    throw new BlockedAddressError(`Could not resolve webhook host: ${host}`)
  }

  if (addresses.length === 0) {
    throw new BlockedAddressError(`Could not resolve webhook host: ${host}`)
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new BlockedAddressError(
        `Webhook URL resolves to a non-public address (${address})`
      )
    }
  }
}

// ── Guarded fetch ────────────────────────────────────────────────────────────

export type SafeFetchResult = {
  status: number
  ok: boolean
  body: string
}

/**
 * POSTs a pre-serialised JSON body to a customer-controlled URL with SSRF,
 * timeout, and size guards.
 *
 * Takes `body` as a string rather than an object on purpose: the caller signs
 * these exact bytes (see `callWebhook`), and serialising again in here would
 * mean the signature covers a different byte sequence than the one actually
 * transmitted. Identical today, but it is the kind of gap that silently breaks
 * signature verification the moment anything touches serialisation.
 *
 * Redirects are never followed (`redirect: 'manual'`). A followed redirect
 * would re-open everything the pre-flight DNS check just closed: an attacker
 * controls a public host, we validate it, and it answers `302 Location:
 * http://169.254.169.254/`. A 3xx is surfaced to the customer as a failed
 * delivery so they can fix their endpoint.
 */
export async function safePostJson(
  rawUrl: string,
  body: string,
  headers: Record<string, string> = {}
): Promise<SafeFetchResult> {
  const url = new URL(rawUrl)

  if (url.protocol !== 'https:') {
    throw new BlockedAddressError('Webhook URL must use https')
  }
  if (url.username || url.password) {
    throw new BlockedAddressError('Webhook URL must not contain credentials')
  }

  // Re-resolve on every send. The save-time check can be stale by hours.
  await assertResolvesToPublicAddress(url.hostname)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
      redirect: 'manual',
      signal: controller.signal,
    })

    if (res.status >= 300 && res.status < 400) {
      throw new BlockedAddressError(
        `Webhook endpoint returned a redirect (${res.status}); redirects are not followed`
      )
    }

    return {
      status: res.status,
      ok: res.ok,
      body: await readCapped(res),
    }
  } catch (err) {
    if (err instanceof BlockedAddressError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Webhook request timed out after ${REQUEST_TIMEOUT_MS}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Reads at most MAX_RESPONSE_BYTES. A hostile endpoint could otherwise stream
// gigabytes into a serverless function that only wants an error message.
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return ''

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (total < MAX_RESPONSE_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  return Buffer.concat(chunks).subarray(0, MAX_RESPONSE_BYTES).toString('utf8')
}
