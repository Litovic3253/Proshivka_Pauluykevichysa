import { describe, expect, it } from 'vitest'
import { identifyFile, MANUAL_CHIPS } from '@/library/identify'
import { loadFixture } from '../helpers/fixtures'
import { buildEspFlash } from '../helpers/espFlash'

describe('identifyFile', () => {
  it('.hex — прошивка Arduino', () => {
    const f = identifyFile('blink.ino.hex', loadFixture('avr-blink.hex'))
    expect(f).toMatchObject({ name: 'blink.ino', family: 'avr', chip: 'ATmega328P', kind: 'full', baseAddress: 0 })
    expect(f.data[0]).toBe(0x0c)
  })

  it('битый .hex — ошибка с номером строки', () => {
    expect(() => identifyFile('x.hex', new TextEncoder().encode(':00000001FE\n'))).toThrow(/Строка 1/)
  })

  it('приложение ESP32 с паспортом', () => {
    expect(identifyFile('app.bin', loadFixture('esp32-app.bin'))).toMatchObject({
      family: 'esp32',
      chip: 'ESP32',
      kind: 'app',
      baseAddress: 0x10000,
      appName: 'pauluk_fixture',
      appVersion: '1.2.3',
    })
  })

  it('полная flash ESP32 (загрузчик на 0x1000)', () => {
    expect(identifyFile('dump.bin', buildEspFlash())).toMatchObject({ family: 'esp32', chip: 'ESP32', kind: 'full', baseAddress: 0 })
  })

  it('полная flash ESP32-S3 (загрузчик на 0x0)', () => {
    const flash = new Uint8Array(0x10000).fill(0xff)
    const boot = loadFixture('esp32-bootloader.bin').slice()
    boot[12] = 9 // chip_id ESP32-S3
    flash.set(boot, 0)
    flash.set(loadFixture('esp32-partitions.bin'), 0x8000)
    expect(identifyFile('s3.bin', flash)).toMatchObject({ family: 'esp32', chip: 'ESP32-S3', kind: 'full' })
  })

  it('неизвестные байты — чип выбирает пользователь', () => {
    expect(identifyFile('raw.bin', Uint8Array.of(1, 2, 3))).toMatchObject({ family: null, chip: null, kind: 'full', baseAddress: 0 })
    expect(MANUAL_CHIPS.map((c) => c.chip)).toEqual(['ATmega328P', 'ESP32', 'ESP32-S2', 'ESP32-S3', 'ESP32-C3'])
  })
})
