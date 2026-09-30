import { describe, expect, it } from 'vitest'
import { analyzeFirmware } from '@/analysis/analyze'
import { parseIntelHex } from '@/analysis/intelHex'
import { buildEspFlash } from '../helpers/espFlash'
import { loadFixture, loadFixtureText } from '../helpers/fixtures'

const esp = { family: 'esp32' as const, chip: 'ESP32' }

describe('analyzeFirmware', () => {
  it('полная flash ESP32: разделы, загрузчик, паспорт активного приложения', () => {
    const a = analyzeFirmware({ ...esp, kind: 'full', baseAddress: 0 }, buildEspFlash())
    expect(a.partitions).toHaveLength(6)
    expect(a.bootloader?.chipName).toBe('ESP32')
    expect(a.appOffset).toBe(0x10000)
    expect(a.appDesc?.version).toBe('1.2.3')
    expect(a.encrypted).toBe(false)
    expect(a.usage.used).toBeGreaterThan(0)
    expect(a.usage.used).toBeLessThan(a.usage.total)
  })

  it('полная flash с активным ota_1', () => {
    const a = analyzeFirmware({ ...esp, kind: 'full', baseAddress: 0 }, buildEspFlash({ otadata: loadFixture('esp32-otadata-slot1.bin') }))
    expect(a.appOffset).toBe(0x190000)
  })

  it('только приложение', () => {
    const app = loadFixture('esp32-app.bin')
    const a = analyzeFirmware({ ...esp, kind: 'app', baseAddress: 0x10000 }, app)
    expect(a.partitions).toEqual([])
    expect(a.appOffset).toBe(0x10000)
    expect(a.image?.length).toBe(app.length)
    expect(a.appDesc?.projectName).toBe('pauluk_fixture')
    expect(a.encrypted).toBeNull()
  })

  it('раздел с данными — без паспорта', () => {
    const a = analyzeFirmware({ ...esp, kind: 'partition', baseAddress: 0x9000 }, new Uint8Array(0x4000).fill(0xff))
    expect(a.appDesc).toBeNull()
    expect(a.usage.percent).toBe(0)
  })

  it('Arduino — только занятость по страницам 128 байт', () => {
    const img = parseIntelHex(loadFixtureText('avr-blink.hex'))
    const data = new Uint8Array(0x8000).fill(0xff)
    data.set(img.data)
    const a = analyzeFirmware({ family: 'avr', chip: 'ATmega328P', kind: 'full', baseAddress: 0 }, data)
    expect(a.image).toBeNull()
    expect(a.usage.used % 128).toBe(0)
    expect(a.usage.used).toBeGreaterThanOrEqual(img.data.length - 127)
  })
})
