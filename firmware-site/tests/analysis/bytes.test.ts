import { describe, expect, it } from 'vitest'
import { concatBytes, cString, formatSize, hexAddr, hexBytes, sameBytes, u16le, u32le } from '@/analysis/bytes'
import { usage } from '@/analysis/usage'
import { sha256Hex } from '@/analysis/hash'

describe('bytes', () => {
  it('читает little-endian числа', () => {
    const b = Uint8Array.from([0x32, 0x54, 0xcd, 0xab])
    expect(u16le(b, 0)).toBe(0x5432)
    expect(u32le(b, 0)).toBe(0xabcd5432)
  })

  it('читает C-строку до нуля и до предела', () => {
    const b = new TextEncoder().encode('blink\0мусор')
    expect(cString(b, 0, 32)).toBe('blink')
    expect(cString(b, 0, 3)).toBe('bli')
  })

  it('форматирует адреса, байты и размеры по-русски', () => {
    expect(hexAddr(0x8000)).toBe('0x00008000')
    expect(hexAddr(0x1f, 2)).toBe('0x1F')
    expect(hexBytes([0x1e, 0x95, 0x0f])).toBe('1E 95 0F')
    expect(formatSize(512)).toBe('512 Б')
    expect(formatSize(1536)).toBe('1,5 КБ')
    expect(formatSize(4 * 1024 * 1024)).toBe('4 МБ')
  })

  it('склеивает и сравнивает массивы', () => {
    expect(Array.from(concatBytes(Uint8Array.of(1), Uint8Array.of(2, 3)))).toEqual([1, 2, 3])
    expect(sameBytes([1, 2], Uint8Array.of(1, 2))).toBe(true)
    expect(sameBytes([1, 2], [1, 3])).toBe(false)
    expect(sameBytes([1], [1, 2])).toBe(false)
  })
})

describe('usage', () => {
  it('считает занятые блоки, а не последний байт', () => {
    const data = new Uint8Array(4096 * 4).fill(0xff)
    data[10] = 0
    data[4096 * 3 + 5] = 1 // данные в конце flash, как SPIFFS у ESP32
    expect(usage(data, 4096)).toEqual({ used: 8192, free: 8192, total: 16384, percent: 50 })
  })

  it('пустая flash — 0 %', () => {
    expect(usage(new Uint8Array(256).fill(0xff), 128).percent).toBe(0)
  })
})

describe('sha256Hex', () => {
  it('считает SHA-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
