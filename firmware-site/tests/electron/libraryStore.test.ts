import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLibraryStore, safeFileName } from '../../electron/libraryStore.mjs'

let dir: string
let clock: number
const trashed: string[] = []
const deps = () => ({
  now: () => new Date(clock++ * 1000),
  trash: async (p: string) => { trashed.push(path.basename(p)); await rm(p) },
  log: () => {},
})
const meta = (name: string) => ({
  name, family: 'avr', chip: 'ATmega328P', kind: 'full', baseAddress: 0, sha256: 'abc', source: 'board', note: '',
})

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'pauluk-')), 'Прошивки')
  clock = 1
  trashed.length = 0
})
afterEach(async () => { await rm(path.dirname(dir), { recursive: true, force: true }) })

describe('safeFileName', () => {
  it('заменяет запрещённые в Windows символы и пустое имя', () => {
    expect(safeFileName('a:b*c?"d<e>f|g/h\\i')).toBe('a_b_c_d_e_f_g_h_i')
    expect(safeFileName('  ..  ')).toBe('firmware')
    expect(safeFileName('Котёл на даче')).toBe('Котёл на даче')
  })
})

describe('libraryStore', () => {
  it('пустая библиотека создаёт папку', async () => {
    const s = createLibraryStore(dir, deps())
    expect(await s.list()).toEqual([])
    expect(await readdir(dir)).toEqual([])
  })

  it('сохраняет файл прошивки, EEPROM и library.json; без *.tmp', async () => {
    const s = createLibraryStore(dir, deps())
    const rec = await s.save(meta('Nano'), Uint8Array.of(1, 2, 3), Uint8Array.of(9))
    expect(rec).toMatchObject({ id: 1, name: 'Nano', size: 3, hasEeprom: true, file: 'Nano.bin', eepromFile: 'Nano_eeprom.bin', createdAt: 1000 })
    expect([...(await readFile(path.join(dir, 'Nano.bin')))]).toEqual([1, 2, 3])
    const files = await readdir(dir)
    expect(files.sort()).toEqual(['Nano.bin', 'Nano_eeprom.bin', 'library.json'])
    const index = JSON.parse(await readFile(path.join(dir, 'library.json'), 'utf8'))
    expect(index).toMatchObject({ version: 1, nextId: 2 })
    expect(Array.from((await s.read(1))!.data)).toEqual([1, 2, 3])
    expect(Array.from((await s.read(1))!.eeprom!)).toEqual([9])
  })

  it('одинаковые имена не перезаписывают друг друга', async () => {
    const s = createLibraryStore(dir, deps())
    await s.save(meta('x'), Uint8Array.of(1))
    const second = await s.save(meta('x'), Uint8Array.of(2))
    expect(second.file).toBe('x (2).bin')
    expect([...(await readFile(path.join(dir, 'x.bin')))]).toEqual([1])
  })

  it('список — новые сверху; номера продолжаются после перезапуска', async () => {
    const s = createLibraryStore(dir, deps())
    await s.save(meta('старая'), Uint8Array.of(1))
    await s.save(meta('новая'), Uint8Array.of(1))
    expect((await s.list()).map((r: { name: string }) => r.name)).toEqual(['новая', 'старая'])
    const again = createLibraryStore(dir, deps())
    expect((await again.save(meta('третья'), Uint8Array.of(1))).id).toBe(3)
  })

  it('переименование переименовывает и файлы', async () => {
    const s = createLibraryStore(dir, deps())
    await s.save(meta('a'), Uint8Array.of(5), Uint8Array.of(6))
    await s.save(meta('b'), Uint8Array.of(7))
    const rec = await s.update(1, { name: 'b', note: 'с дачи' })
    expect(rec).toMatchObject({ name: 'b', note: 'с дачи', file: 'b (2).bin', eepromFile: 'b_eeprom.bin' })
    expect((await readdir(dir)).sort()).toEqual(['b (2).bin', 'b.bin', 'b_eeprom.bin', 'library.json'])
    expect(Array.from((await s.read(1))!.data)).toEqual([5])
  })

  it('удаление отправляет файлы в Корзину и убирает запись', async () => {
    const s = createLibraryStore(dir, deps())
    await s.save(meta('a'), Uint8Array.of(1), Uint8Array.of(2))
    await s.remove(1)
    expect(trashed.sort()).toEqual(['a.bin', 'a_eeprom.bin'])
    expect(await s.list()).toEqual([])
  })

  it('битый library.json откладывается, файлы прошивок не трогаются', async () => {
    const logs: string[] = []
    const s0 = createLibraryStore(dir, deps())
    await s0.save(meta('a'), Uint8Array.of(1))
    await writeFile(path.join(dir, 'library.json'), '{ сломано')
    const s = createLibraryStore(dir, { ...deps(), log: (m: string) => logs.push(m) })
    expect(await s.list()).toEqual([])
    const files = await readdir(dir)
    expect(files).toContain('a.bin')
    expect(files.some((f) => /^library\.broken-.*\.json$/.test(f))).toBe(true)
    expect(logs.join()).toMatch(/повреждён/)
  })

  it('файл, удалённый руками, — запись остаётся, read возвращает null', async () => {
    const s = createLibraryStore(dir, deps())
    await s.save(meta('a'), Uint8Array.of(1))
    await rm(path.join(dir, 'a.bin'))
    expect(await s.list()).toHaveLength(1)
    expect(await s.read(1)).toBeNull()
    expect(await s.filePath(1)).toBeNull()
  })

  it('одновременные сохранения не теряют записи', async () => {
    const s = createLibraryStore(dir, deps())
    await Promise.all([1, 2, 3, 4, 5].map((i) => s.save(meta('same'), Uint8Array.of(i))))
    const recs = await s.list()
    expect(new Set(recs.map((r: { id: number }) => r.id)).size).toBe(5)
    expect(new Set(recs.map((r: { file: string }) => r.file)).size).toBe(5)
  })

  it('папка: путь, число и общий размер', async () => {
    const s = createLibraryStore(dir, deps())
    await s.save(meta('a'), new Uint8Array(10), new Uint8Array(4))
    expect(await s.folderInfo()).toEqual({ path: dir, count: 1, bytes: 14 })
  })

  it('отвергает мусор из IPC', async () => {
    const s = createLibraryStore(dir, deps())
    await expect(s.save({ ...meta(''), name: 42 }, Uint8Array.of(1))).rejects.toThrow(/название/)
    await expect(s.save(meta('a'), 'не байты')).rejects.toThrow(/данные/)
    await expect(s.update(99, { name: 'x' })).rejects.toThrow(/не найдена/)
  })
})
