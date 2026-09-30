import { describe, expect, it } from 'vitest'
import { checkCompatibility } from '@/flash/compat'
import { parsePartitionTable } from '@/analysis/partitions'
import type { BoardInfo } from '@/drivers/types'
import { loadFixture } from '../helpers/fixtures'

const parts = parsePartitionTable(loadFixture('esp32-partitions.bin'))
const ota0 = parts.find((p) => p.label === 'ota_0')!
const ota1 = parts.find((p) => p.label === 'ota_1')!
const esp32: BoardInfo = { family: 'esp32', chip: 'ESP32', flashSize: 0x400000, baud: 921600 }
const nano: BoardInfo = { family: 'avr', chip: 'ATmega328P', flashSize: 0x8000, bootloader: 'optiboot', baud: 115200 }
const fw = (o: Partial<Parameters<typeof checkCompatibility>[0]['firmware']> = {}) => ({
  family: 'esp32' as const,
  chip: 'ESP32',
  kind: 'full' as const,
  size: 0x400000,
  baseAddress: 0,
  ...o,
})

describe('checkCompatibility', () => {
  it('чужой чип — запрет', () => {
    const r = checkCompatibility({ firmware: fw({ chip: 'ESP32-S3' }), board: esp32 })
    expect(r).toEqual({ ok: false, reason: 'Прошивка для ESP32-S3, а подключена ESP32' })
    expect(checkCompatibility({ firmware: fw(), board: nano }).ok).toBe(false)
  })

  it('полный дамп: с адреса 0, не больше flash', () => {
    expect(checkCompatibility({ firmware: fw(), board: esp32 })).toEqual({ ok: true, address: 0, warnings: [] })
    expect(checkCompatibility({ firmware: fw({ size: 0x800000 }), board: esp32 }).ok).toBe(false)
    const smaller = checkCompatibility({ firmware: fw({ size: 0x200000 }), board: esp32 })
    expect(smaller.ok && smaller.warnings[0]).toMatch(/меньше flash платы/)
  })

  it('приложение пишется в активный раздел платы-получателя', () => {
    const r = checkCompatibility({ firmware: fw({ kind: 'app', size: 0x30000 }), board: esp32, partitions: parts, activeApp: ota1 })
    expect(r).toMatchObject({ ok: true, address: 0x190000 })
    expect(checkCompatibility({ firmware: fw({ kind: 'app', size: 0x200000 }), board: esp32, partitions: parts, activeApp: ota0 }).ok).toBe(false)
    expect(checkCompatibility({ firmware: fw({ kind: 'app', size: 10 }), board: esp32, activeApp: null }).ok).toBe(false)
  })

  it('раздел — по имени из таблицы платы', () => {
    expect(checkCompatibility({ firmware: fw({ kind: 'partition', partitionLabel: 'nvs', size: 0x4000 }), board: esp32, partitions: parts })).toMatchObject({ ok: true, address: 0x9000 })
    expect(checkCompatibility({ firmware: fw({ kind: 'partition', partitionLabel: 'нет', size: 1 }), board: esp32, partitions: parts }).ok).toBe(false)
  })

  it('Arduino: с адреса 0, предупреждение про область загрузчика', () => {
    const avr = { family: 'avr' as const, chip: 'ATmega328P', kind: 'full' as const, baseAddress: 0 }
    expect(checkCompatibility({ firmware: { ...avr, size: 2000 }, board: nano })).toEqual({ ok: true, address: 0, warnings: [] })
    const full = checkCompatibility({ firmware: { ...avr, size: 0x8000 }, board: nano })
    expect(full.ok && full.warnings[0]).toMatch(/загрузчик/)
  })

  it('Arduino: HEX не с адреса 0 (например, сам загрузчик) — запрет', () => {
    const r = checkCompatibility({ firmware: { family: 'avr', chip: 'ATmega328P', kind: 'full', size: 512, baseAddress: 0x7e00 }, board: nano })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/0x00007E00/)
  })
})
