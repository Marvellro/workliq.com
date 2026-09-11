import { describe, it, expect, vi, afterEach } from 'vitest'
import { isBlockedAddress, validateWebhookUrl, BlockedAddressError } from '../safe-fetch'

// DNS is mocked so these tests assert our policy, not the resolver's behaviour
// or the state of the network.
vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}))

import { lookup } from 'dns/promises'
const mockLookup = vi.mocked(lookup)

afterEach(() => {
  vi.resetAllMocks()
})

describe('isBlockedAddress — IPv4', () => {
  it('blocks cloud instance metadata', () => {
    // The single most valuable SSRF target: on most cloud providers this
    // endpoint hands out credentials for the machine's own IAM role.
    expect(isBlockedAddress('169.254.169.254')).toBe(true)
  })

  it.each([
    ['0.0.0.0', 'this network'],
    ['127.0.0.1', 'loopback'],
    ['127.0.0.53', 'loopback (systemd-resolved)'],
    ['10.0.0.5', 'RFC1918'],
    ['172.16.0.1', 'RFC1918 lower bound'],
    ['172.31.255.254', 'RFC1918 upper bound'],
    ['192.168.1.1', 'RFC1918'],
    ['169.254.1.1', 'link-local'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['52.201.100.3'],
    // Adjacent to private ranges but genuinely public — the mask arithmetic
    // must not over-block.
    ['172.15.255.255'],
    ['172.32.0.1'],
    ['11.0.0.1'],
    ['100.63.255.255'],
  ])('allows public address %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false)
  })

  it('blocks non-canonical octet encodings', () => {
    // Zero-padded and hex octets are accepted by some resolvers and HTTP
    // clients as 127.0.0.1; treating them as unparseable fails closed.
    expect(isBlockedAddress('0177.0.0.1')).toBe(true)
    expect(isBlockedAddress('0x7f.0.0.1')).toBe(true)
    expect(isBlockedAddress('127.1')).toBe(true)
  })
})

describe('isBlockedAddress — IPv6', () => {
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link-local'],
    ['fd00::1', 'unique local'],
    ['fc00::1', 'unique local'],
    ['ff02::1', 'multicast'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it('blocks IPv4-mapped loopback and private addresses', () => {
    // ::ffff:127.0.0.1 reaches loopback. Judging it as "an IPv6 address that
    // doesn't start with fe80/fc/fd" would let it straight through.
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true)
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true)
  })

  it('allows IPv4-mapped public addresses', () => {
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false)
  })

  it('allows public IPv6', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false)
  })

  it('blocks a link-local address carrying a zone index', () => {
    expect(isBlockedAddress('fe80::1%eth0')).toBe(true)
  })
})

describe('isBlockedAddress — non-addresses', () => {
  it('fails closed on anything that is not an IP', () => {
    for (const value of ['', 'localhost', 'not-an-ip', '999.999.999.999']) {
      expect(isBlockedAddress(value)).toBe(true)
    }
  })
})

describe('validateWebhookUrl', () => {
  it('rejects non-https schemes', async () => {
    await expect(validateWebhookUrl('http://example.com/hook')).rejects.toThrow(
      BlockedAddressError
    )
    // file:// and gopher:// are classic SSRF escalations.
    await expect(validateWebhookUrl('file:///etc/passwd')).rejects.toThrow(
      BlockedAddressError
    )
  })

  it('rejects malformed URLs', async () => {
    await expect(validateWebhookUrl('not a url')).rejects.toThrow(BlockedAddressError)
  })

  it('rejects embedded credentials', async () => {
    await expect(
      validateWebhookUrl('https://user:pass@example.com/hook')
    ).rejects.toThrow(/credentials/)
  })

  it('rejects a bare private IP literal without consulting DNS', async () => {
    await expect(validateWebhookUrl('https://127.0.0.1/hook')).rejects.toThrow(
      /non-public address/
    )
    expect(mockLookup).not.toHaveBeenCalled()
  })

  it('rejects a bracketed IPv6 literal without consulting DNS', async () => {
    // new URL().hostname keeps the brackets ("[::1]"), which isIP() rejects.
    // Without stripping them this fell through to the DNS path and was only
    // blocked by the lookup happening to fail.
    await expect(validateWebhookUrl('https://[::1]/hook')).rejects.toThrow(
      /non-public address/
    )
    await expect(
      validateWebhookUrl('https://[fd00::1]/hook')
    ).rejects.toThrow(/non-public address/)
    expect(mockLookup).not.toHaveBeenCalled()
  })

  it('accepts a bracketed public IPv6 literal', async () => {
    await expect(
      validateWebhookUrl('https://[2606:4700:4700::1111]/hook')
    ).resolves.toBeUndefined()
    expect(mockLookup).not.toHaveBeenCalled()
  })

  it('accepts a hostname resolving to a public address', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
    await expect(validateWebhookUrl('https://example.com/hook')).resolves.toBeUndefined()
  })

  it('rejects a hostname resolving to a private address', async () => {
    // The DNS-rebinding shape: an attacker-controlled public hostname whose
    // A record points inside our network.
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never)
    await expect(validateWebhookUrl('https://evil.example.com/hook')).rejects.toThrow(
      /non-public address/
    )
  })

  it('rejects when ANY resolved address is private', async () => {
    // A record set mixing one public and one internal address must be refused
    // outright — checking only the first entry would let this through.
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ] as never)
    await expect(validateWebhookUrl('https://mixed.example.com/hook')).rejects.toThrow(
      /non-public address/
    )
  })

  it('rejects a hostname that does not resolve', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(validateWebhookUrl('https://nope.invalid/hook')).rejects.toThrow(
      /Could not resolve/
    )
  })

  it('rejects a hostname resolving to nothing', async () => {
    mockLookup.mockResolvedValue([] as never)
    await expect(validateWebhookUrl('https://empty.example.com/hook')).rejects.toThrow(
      /Could not resolve/
    )
  })
})
