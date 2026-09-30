import { describe, expect, it } from 'vitest'
import { extractStrings } from '@/analysis/strings'
import { parseIntelHex } from '@/analysis/intelHex'
import { loadFixtureText } from '../helpers/fixtures'

describe('extractStrings', () => {
  it('находит ASCII и кириллицу UTF-8 с адресами', () => {
    const enc = new TextEncoder()
    const data = new Uint8Array([0, 1, ...enc.encode('Hello, мир!'), 0, ...enc.encode('ab'), 0])
    expect(extractStrings(data, 0x100)).toEqual([{ address: 0x102, text: 'Hello, мир!' }])
  })

  it('соблюдает минимальную длину и предел количества', () => {
    const data = new TextEncoder().encode('abcde\0fghij\0klmno')
    expect(extractStrings(data, 0, 5, 2).map((s) => s.text)).toEqual(['abcde', 'fghij'])
    expect(extractStrings(data, 0, 6)).toEqual([])
  })

  it('находит строку из прошивки Arduino', () => {
    const img = parseIntelHex(loadFixtureText('avr-blink.hex'))
    expect(extractStrings(img.data).map((s) => s.text)).toContain('Privet ot Paulukevichusa')
  })
})
