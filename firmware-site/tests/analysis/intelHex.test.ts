import { describe, expect, it } from 'vitest'
import { formatIntelHex, parseIntelHex } from '@/analysis/intelHex'
import { loadFixtureText } from '../helpers/fixtures'

describe('parseIntelHex', () => {
  it('разбирает запись данных и проверяет контрольную сумму', () => {
    const img = parseIntelHex(':100000000C9434000C943E000C943E000C943E0082\n:00000001FF\n')
    expect(img.baseAddress).toBe(0)
    expect(Array.from(img.data.subarray(0, 4))).toEqual([0x0c, 0x94, 0x34, 0x00])
    expect(img.data.length).toBe(16)
  })

  it('учитывает расширенный линейный адрес (тип 04)', () => {
    const img = parseIntelHex(':020000040001F9\n:0100000055AA\n:00000001FF\n')
    expect(img.baseAddress).toBe(0x10000)
    expect(Array.from(img.data)).toEqual([0x55])
  })

  it('сообщает номер строки при неверной контрольной сумме', () => {
    expect(() => parseIntelHex(':00000001FF\n'.replace('FF', 'FE'))).toThrow(/Строка 1: неверная контрольная сумма/)
  })

  it('отвергает не-HEX текст', () => {
    expect(() => parseIntelHex('hello world')).toThrow(/Строка 1: это не Intel HEX/)
  })

  it('отвергает файл без данных', () => {
    expect(() => parseIntelHex(':00000001FF\n')).toThrow(/нет данных/)
  })

  it('разбирает настоящую прошивку Arduino', () => {
    const img = parseIntelHex(loadFixtureText('avr-blink.hex'))
    expect(img.baseAddress).toBe(0)
    expect(img.data[0]).toBe(0x0c) // таблица векторов: jmp
    expect(img.data.length).toBeGreaterThan(1000)
    expect(img.data.length).toBeLessThan(0x7e00)
  })
})

describe('formatIntelHex', () => {
  it('туда и обратно даёт те же байты, пропуская пустые записи', () => {
    const data = new Uint8Array(64).fill(0xff)
    for (let i = 0; i < 16; i++) data[i] = i + 1
    data.fill(0xab, 48)
    const text = formatIntelHex(data)
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(3) // две записи данных + конец файла
    const back = parseIntelHex(text)
    expect(back.baseAddress).toBe(0)
    expect(Array.from(back.data)).toEqual(Array.from(data))
  })

  it('пишет запись 04 при адресах выше 64 КБ', () => {
    const text = formatIntelHex(Uint8Array.of(0x55), 0x10000)
    expect(text.startsWith(':020000040001F9\r\n:0100000055AA\r\n')).toBe(true)
  })
})
