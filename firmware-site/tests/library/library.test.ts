import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  deleteFirmware, getFirmware, getFirmwareData, kindLabel, libraryFolder, listFirmware, saveFirmware,
  showFirmwareInFolder, subscribeLibrary, updateFirmware, type NewFirmware,
} from '@/library/library'
import { installFakeBridge } from '../helpers/fakeBridge'

let env: Awaited<ReturnType<typeof installFakeBridge>>
beforeEach(async () => { env = await installFakeBridge() })
afterEach(async () => { await env.cleanup() })

const sample = (name: string, data = Uint8Array.of(1, 2, 3)): NewFirmware => ({
  name, family: 'avr', chip: 'ATmega328P', kind: 'full', baseAddress: 0, data, source: 'board',
})

describe('library через мост', () => {
  it('сохраняет с SHA-256, байты читаются обратно', async () => {
    const rec = await saveFirmware({ ...sample('a'), eeprom: Uint8Array.of(9) })
    expect(rec).toMatchObject({ name: 'a', size: 3, hasEeprom: true, file: 'a.bin' })
    expect(rec.sha256).toBe('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81')
    const blob = await getFirmwareData(rec.id)
    expect(Array.from(blob!.data)).toEqual([1, 2, 3])
    expect(Array.from(blob!.eeprom!)).toEqual([9])
  })

  it('сообщает подписчикам об изменениях', async () => {
    let calls = 0
    const off = subscribeLibrary(() => calls++)
    const rec = await saveFirmware(sample('a'))
    await updateFirmware(rec.id, { note: 'x' })
    await deleteFirmware(rec.id)
    off()
    await saveFirmware(sample('b'))
    expect(calls).toBe(3)
  })

  it('список, поиск записи, папка', async () => {
    await saveFirmware(sample('старая'))
    const b = await saveFirmware(sample('новая'))
    expect((await listFirmware()).map((r) => r.name)).toEqual(['новая', 'старая'])
    expect((await getFirmware(b.id))?.name).toBe('новая')
    expect(await libraryFolder()).toMatchObject({ path: env.dir, count: 2, bytes: 6 })
    await showFirmwareInFolder(b.id)
    expect(env.shown).toEqual([b.id])
  })

  it('файл удалён руками — данных нет, запись есть', async () => {
    const rec = await saveFirmware(sample('a'))
    await rm(path.join(env.dir, 'a.bin'))
    expect(await getFirmwareData(rec.id)).toBeUndefined()
    expect(await getFirmware(rec.id)).toBeTruthy()
  })

  it('файл подменили вне программы — данные не отдаются на анализ и заливку', async () => {
    const rec = await saveFirmware(sample('a'))
    await writeFile(path.join(env.dir, 'a.bin'), Uint8Array.of(9, 9, 9, 9)) // другой размер
    await expect(getFirmwareData(rec.id)).rejects.toThrow(/изменён вне программы/)
    await writeFile(path.join(env.dir, 'a.bin'), Uint8Array.of(3, 2, 1)) // тот же размер, другое содержимое
    await expect(getFirmwareData(rec.id)).rejects.toThrow(/изменён вне программы/)
  })

  it('удаление навсегда доходит до хранилища', async () => {
    const rec = await saveFirmware(sample('a'))
    await deleteFirmware(rec.id, true)
    expect(await listFirmware()).toEqual([])
  })

  it('подписи типа дампа', () => {
    expect(kindLabel({ kind: 'full' })).toBe('Вся flash')
    expect(kindLabel({ kind: 'partition', partitionLabel: 'nvs' })).toBe('Раздел nvs')
  })
})
