import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/library/db'
import {
  deleteFirmware,
  getFirmware,
  getFirmwareData,
  kindLabel,
  listFirmware,
  saveFirmware,
  updateFirmware,
  type NewFirmware,
} from '@/library/library'
import { defaultName } from '@/library/naming'

const sample = (name: string, data = Uint8Array.of(1, 2, 3)): NewFirmware => ({
  name,
  family: 'avr',
  chip: 'ATmega328P',
  kind: 'full',
  baseAddress: 0,
  data,
  source: 'board',
})

beforeEach(async () => {
  await db.records.clear()
  await db.blobs.clear()
})
afterEach(() => vi.restoreAllMocks())

describe('library', () => {
  it('сохраняет запись с размером, SHA-256 и байтами отдельно', async () => {
    const rec = await saveFirmware({ ...sample('a'), eeprom: Uint8Array.of(9) })
    expect(rec).toMatchObject({ name: 'a', size: 3, note: '', hasEeprom: true })
    expect(rec.sha256).toBe('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81')
    const blob = await getFirmwareData(rec.id)
    expect(Array.from(blob!.data)).toEqual([1, 2, 3])
    expect(Array.from(blob!.eeprom!)).toEqual([9])
  })

  it('список — новые сверху', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000)
    await saveFirmware(sample('старая'))
    await saveFirmware(sample('новая'))
    expect((await listFirmware()).map((r) => r.name)).toEqual(['новая', 'старая'])
  })

  it('переименование, заметка и удаление', async () => {
    const rec = await saveFirmware(sample('a'))
    await updateFirmware(rec.id, { name: 'b', note: 'с дачи' })
    expect(await getFirmware(rec.id)).toMatchObject({ name: 'b', note: 'с дачи' })
    await deleteFirmware(rec.id)
    expect(await getFirmware(rec.id)).toBeUndefined()
    expect(await getFirmwareData(rec.id)).toBeUndefined()
  })

  it('подписи типа дампа', () => {
    expect(kindLabel({ kind: 'full' })).toBe('Вся flash')
    expect(kindLabel({ kind: 'app' })).toBe('Приложение')
    expect(kindLabel({ kind: 'partition', partitionLabel: 'nvs' })).toBe('Раздел nvs')
  })
})

describe('defaultName', () => {
  it('чип, имя проекта и время, без запрещённых в Windows символов', () => {
    const d = new Date(2026, 8, 30, 15, 7)
    expect(defaultName('ESP32-S3', 'blink', d)).toBe('ESP32-S3_blink_2026-09-30_15-07')
    expect(defaultName('ATmega328P', undefined, d)).toBe('ATmega328P_firmware_2026-09-30_15-07')
    expect(defaultName('ESP32', 'my app:v2', d)).toBe('ESP32_my_app_v2_2026-09-30_15-07')
  })
})
