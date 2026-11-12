import { describe, it, expect } from 'vitest'
import { normaliseEmail, cleanText, confirmHeading, welcomeHeading } from '../waitlist'

// The public waitlist's input rules. A name is optional — the bottom-of-page
// form never asks for one — and the address is checked before anything is
// stored or sent, so a typo is answered as a typo rather than as a failed
// email.

describe('normaliseEmail', () => {
  it('lowercases and trims, so one person is one entry', () => {
    expect(normaliseEmail('  Ada@Example.COM ')).toBe('ada@example.com')
  })

  it.each([
    ['missing @', 'ada.example.com'],
    ['nothing before @', '@example.com'],
    ['no dot in the domain', 'ada@example'],
    ['whitespace inside', 'ada lovelace@example.com'],
    ['two @', 'ada@@example.com'],
    ['empty', ''],
    ['only spaces', '   '],
  ])('refuses an address with %s', (_why, value) => {
    expect(normaliseEmail(value)).toBeNull()
  })

  it('refuses anything that is not a string', () => {
    for (const value of [undefined, null, 42, { email: 'a@b.co' }, ['a@b.co']]) {
      expect(normaliseEmail(value)).toBeNull()
    }
  })

  it('refuses an address longer than the 254 characters an address can be', () => {
    expect(normaliseEmail(`${'a'.repeat(245)}@example.com`)).toBeNull()
  })
})

describe('cleanText', () => {
  it('is empty when the field was not sent', () => {
    expect(cleanText(undefined)).toBe('')
    expect(cleanText(null)).toBe('')
    expect(cleanText(7)).toBe('')
  })

  it('trims, and caps what a stranger can store', () => {
    expect(cleanText('  Ada  ')).toBe('Ada')
    expect(cleanText('x'.repeat(500))).toHaveLength(100)
  })
})

describe('the email headings', () => {
  it('greet by name when there is one, escaped', () => {
    expect(confirmHeading('Ada')).toBe('Hi Ada, confirm your spot 👋')
    expect(welcomeHeading('<b>Ada</b>')).toBe("You're in, &lt;b&gt;Ada&lt;/b&gt;. 🎉")
  })

  it('read naturally when there is none', () => {
    expect(confirmHeading('')).toBe('Hi there, confirm your spot 👋')
    expect(welcomeHeading('')).toBe("You're in. 🎉")
  })
})
