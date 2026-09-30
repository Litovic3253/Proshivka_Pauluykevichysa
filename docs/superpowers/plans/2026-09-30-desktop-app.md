# Прошивки Паулюкевичуса — программа для Windows: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить готовый React-сайт в переносную программу для Windows на Electron — с окном выбора COM-порта по имени, библиотекой в папке «Прошивки» рядом с `.exe`, заставкой и своей иконкой, как у Студии Паулюкевичуса.

**Architecture:** Electron main-процесс (`electron/app.mjs`) открывает заставку и главное окно, перехватывает `select-serial-port` и обслуживает IPC; хранилище — чистый Node-модуль `electron/libraryStore.mjs` поверх файлов; `electron/preload.cjs` отдаёт интерфейсу мост `window.pauluk`. Интерфейс (React) остаётся прежним, меняются только библиотека (через мост), окно выбора порта и кнопки сохранения.

**Tech Stack:** Electron 39.8.x (последняя с поддержкой Node 20), electron-builder 26 (portable), @resvg/resvg-js + png-to-ico (иконка), существующий стек Vite 6 / React 19 / TS / Tailwind 4 / shadcn / Vitest 3.

**Spec:** `docs/superpowers/specs/2026-09-30-desktop-app-design.md` (дополняет `docs/superpowers/specs/2026-09-30-firmware-reader-design.md`)

Пути ниже — относительно `firmware-site/`, если не сказано иное. Команды — из `firmware-site/` в Git Bash. Ветка — `feat/firmware-site`.

## Global Constraints

- Node на ПК 20.18 → Electron **39.8.x** (40+ требует Node ≥ 22.12). electron-builder **26.x**.
- Главное окно: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; интерфейс видит только `window.pauluk`.
- Preload — только CommonJS (`preload.cjs`); остальной код Electron — ESM (`.mjs`, в `package.json` уже `"type": "module"`).
- Папка данных: `process.env.PORTABLE_EXECUTABLE_DIR`, иначе при `app.isPackaged` — папка `.exe`, иначе `firmware-site/`; внутри — `Прошивки/`.
- `Прошивки/library.json` = `{ "version": 1, "nextId": number, "records": FirmwareRecord[] }`; файлы `<имя>.bin`, `<имя>_eeprom.bin`; запрещённые в Windows символы → `_`; повтор имени → ` (2)`, ` (3)`…
- Запись атомарная (`*.tmp` → `rename`); удаление — в Корзину (`shell.trashItem`).
- Иконка: фон `#FABD2F`, рисунок `#1D2021`, скруглённый квадрат `x=7 y=7 242×242 rx=56` (как у иконки Студии).
- Заставка: 1 % за 18 мс, шаги 25 % «Открываю окно», 60 % «Загружаю интерфейс», 100 % «Готово»; запасной таймаут 15 с.
- Vite `base: './'` (загрузка через `file://`); все ссылки на `icon.png` относительные.
- Интерфейс, сообщения и комментарии — на русском.
- Коммиты только локальные.

## Review Focus

1. **Два экземпляра программы пишут один `library.json`.** Ожидание: второй запуск лишь выводит на передний план первое окно. Тест: не автоматизируется (Electron), проверяется вручную в Task 6 двойным запуском `.exe`.
2. **Пользователь переименовал или удалил файл прошивки руками в Проводнике.** Ожидание: список открывается, запись остаётся, при анализе/заливке — «Файл прошивки не найден в папке». Тест: «пропавший файл» в Task 2 и `getFirmwareData → undefined` в Task 3.
3. **Окно выбора порта закрыли крестиком или Esc.** Ожидание: запрос порта отменяется (как «Отмена»), подключение не зависает в «Определяю плату…». Тест: `choosePort(null)` вызывает `bridge.ports.choose(null)` в Task 4.
4. **Имя прошивки с символами `:*?"<>|/\` или совпадающее с существующим.** Ожидание: файл создаётся с заменой на `_` и суффиксом ` (2)`, старый не перезаписан. Тест: Task 2.
5. **Плату подключили, когда окно выбора уже открыто.** Ожидание: порт появляется в списке без переоткрытия. Тест: `serial-port-added` пересылает обновлённый список — ручная проверка в Task 6; логика хранилища списка — тест `onRequest` повторно в Task 4.

---

### Task 1: Иконка программы

**Files:**
- Create: `tools/make-icon.mjs`
- Create (результат скрипта): `build/icon.png`, `build/icon.ico`, `public/icon.png` (заменяет иконку Студии)
- Test: `tests/tools/icon.test.ts`

**Interfaces:**
- Produces: `iconSvg(): string` (SVG 256×256), `renderPng(size: number): Buffer`, CLI `node tools/make-icon.mjs`.

- [ ] **Step 1: Поставить зависимости**

```bash
npm install -D @resvg/resvg-js@2 png-to-ico@3
```

- [ ] **Step 2: Падающий тест**

`tests/tools/icon.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { iconSvg, renderPng } from '../../tools/make-icon.mjs'
import { Resvg } from '@resvg/resvg-js'

function pixel(size: number, x: number, y: number): number[] {
  const img = new Resvg(iconSvg(), { fitTo: { mode: 'width', value: size } }).render()
  const i = (y * img.width + x) * 4
  return Array.from(img.pixels.subarray(i, i + 4))
}

describe('иконка', () => {
  it('жёлтый скруглённый квадрат Студии с тёмной микросхемой по центру', () => {
    expect(pixel(256, 2, 2)[3]).toBe(0) // угол прозрачный
    expect(pixel(256, 40, 128)).toEqual([0xfa, 0xbd, 0x2f, 255]) // жёлтый фон
    expect(pixel(256, 128, 128)).toEqual([0x1d, 0x20, 0x21, 255]) // тёмное ядро микросхемы
  })

  it('PNG нужного размера', () => {
    const png = renderPng(64)
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(64) // ширина из IHDR
  })
})
```

- [ ] **Step 3: Запустить — падает**

Run: `npx vitest run tests/tools/icon.test.ts`
Expected: FAIL — `Failed to resolve import "../../tools/make-icon.mjs"`.

- [ ] **Step 4: Скрипт иконки**

`tools/make-icon.mjs`:

```js
/** Иконка «Прошивок Паулюкевичуса»: жёлтый квадрат Студии, вместо кубика — микросхема. */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const BG = '#FABD2F'
const FG = '#1D2021'

export function iconSvg() {
  const pins = [103, 128, 153]
  const lines = pins
    .flatMap((p) => [
      `M${p} 52V78`, `M${p} 178V204`, // сверху и снизу
      `M52 ${p}H78`, `M178 ${p}H204`, // слева и справа
    ])
    .join(' ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect x="7" y="7" width="242" height="242" rx="56" fill="${BG}"/>
  <path d="${lines}" stroke="${FG}" stroke-width="12" stroke-linecap="round"/>
  <rect x="78" y="78" width="100" height="100" rx="16" fill="none" stroke="${FG}" stroke-width="12"/>
  <rect x="104" y="104" width="48" height="48" rx="8" fill="${FG}"/>
</svg>`
}

export function renderPng(size) {
  return new Resvg(iconSvg(), { fitTo: { mode: 'width', value: size } }).render().asPng()
}

async function main() {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  await mkdir(path.join(root, 'build'), { recursive: true })
  const png256 = renderPng(256)
  await writeFile(path.join(root, 'build', 'icon.png'), png256)
  await writeFile(path.join(root, 'public', 'icon.png'), png256)
  const ico = await pngToIco([16, 24, 32, 48, 64, 128, 256].map(renderPng))
  await writeFile(path.join(root, 'build', 'icon.ico'), ico)
  console.log('Иконка готова: build/icon.ico, build/icon.png, public/icon.png')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
```

- [ ] **Step 5: Тест проходит, иконка создана**

Run: `npx vitest run tests/tools/icon.test.ts && node tools/make-icon.mjs`
Expected: PASS (2 tests), затем «Иконка готова…». Открыть `build/icon.png` (Read) и посмотреть глазами: жёлтый квадрат, микросхема по центру.

- [ ] **Step 6: Commit**

```bash
cd .. && git add firmware-site && git commit -m "feat: своя иконка программы в стиле Студии"
```

---

### Task 2: Хранилище «Прошивки» и папка данных

**Files:**
- Create: `electron/libraryStore.mjs`, `electron/dataDir.mjs`
- Test: `tests/electron/libraryStore.test.ts`, `tests/electron/dataDir.test.ts`
- Modify: `vite.config.ts` (тесты `tests/**/*.test.ts` уже включены — без изменений), корневой `.gitignore` (`firmware-site/Прошивки/`, `firmware-site/dist-app/`)

**Interfaces:**
- Produces:
  - `safeFileName(name: string): string`
  - `createLibraryStore(dir: string, deps?: { trash?: (p: string) => Promise<void>; now?: () => Date; log?: (msg: string) => void })` → `{ dir, list(), save(meta, data, eeprom?), read(id), update(id, patch), remove(id), folderInfo(), filePath(id) }`
  - `dataDir({ env, isPackaged, execPath, devRoot }): string`
- Record shape (совпадает с `src/library/types.ts` в Task 3): `{ id, name, family, chip, kind, partitionLabel?, baseAddress, size, sha256, createdAt, note, source, appName?, appVersion?, hasEeprom, file, eepromFile? }`

- [ ] **Step 1: Падающие тесты**

`tests/electron/libraryStore.test.ts`:

```ts
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
```

`tests/electron/dataDir.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { dataDir } from '../../electron/dataDir.mjs'

describe('dataDir', () => {
  it('переносной exe — папка, где лежит exe', () => {
    expect(dataDir({ env: { PORTABLE_EXECUTABLE_DIR: 'D:\\Прошивки' }, isPackaged: true, execPath: 'C:\\tmp\\x.exe', devRoot: 'C:\\dev' })).toBe('D:\\Прошивки')
  })
  it('собранная программа без portable — рядом с exe; разработка — корень проекта', () => {
    expect(dataDir({ env: {}, isPackaged: true, execPath: path.join('C:', 'app', 'x.exe'), devRoot: 'C:\\dev' })).toBe(path.join('C:', 'app'))
    expect(dataDir({ env: {}, isPackaged: false, execPath: 'electron.exe', devRoot: 'C:\\dev' })).toBe('C:\\dev')
  })
})
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run tests/electron`
Expected: FAIL — `Failed to resolve import "../../electron/libraryStore.mjs"`.

- [ ] **Step 3: Реализовать**

`electron/dataDir.mjs`:

```js
import path from 'node:path'

/** Где лежит папка «Прошивки»: рядом с exe, как данные Студии; при разработке — в корне проекта. */
export function dataDir({ env, isPackaged, execPath, devRoot }) {
  if (env.PORTABLE_EXECUTABLE_DIR) return env.PORTABLE_EXECUTABLE_DIR
  if (isPackaged) return path.dirname(execPath)
  return devRoot
}
```

`electron/libraryStore.mjs`:

```js
/**
 * Библиотека прошивок в обычной папке: library.json со списком и файлы прошивок рядом.
 * Работает без Electron — Корзина передаётся снаружи (shell.trashItem).
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const INDEX = 'library.json'
const META_FIELDS = ['name', 'family', 'chip', 'kind', 'partitionLabel', 'baseAddress', 'sha256', 'source', 'appName', 'appVersion', 'note']

export function safeFileName(name) {
  const cleaned = String(name).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/[. ]+$/, '').trim()
  return (cleaned || 'firmware').slice(0, 120)
}

const exists = (p) => fs.access(p).then(() => true, () => false)

export function createLibraryStore(dir, { trash = (p) => fs.rm(p, { force: true }), now = () => new Date(), log = () => {} } = {}) {
  let state = null
  let queue = Promise.resolve()

  /** Изменения выполняются строго по очереди — library.json не перезапишет сам себя. */
  function serial(fn) {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  async function writeAtomic(file, data) {
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, file)
  }

  async function load() {
    if (state) return state
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, INDEX)
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
      if (!parsed || !Array.isArray(parsed.records) || typeof parsed.nextId !== 'number') throw new Error('неизвестный формат')
      state = parsed
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        state = { version: 1, nextId: 1, records: [] }
      } else {
        const stamp = now().toISOString().replace(/[:.]/g, '-')
        const aside = `library.broken-${stamp}.json`
        await fs.rename(file, path.join(dir, aside)).catch(() => {})
        log(`library.json повреждён и сохранён как ${aside}; библиотека начата заново, файлы прошивок на месте`)
        state = { version: 1, nextId: 1, records: [] }
      }
    }
    return state
  }

  const persist = () => writeAtomic(path.join(dir, INDEX), JSON.stringify(state, null, 2))

  async function uniqueName(base, ext, keep) {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? `${base}${ext}` : `${base} (${n})${ext}`
      if (candidate === keep || !(await exists(path.join(dir, candidate)))) return candidate
    }
  }

  function find(id) {
    const rec = state.records.find((r) => r.id === id)
    if (!rec) throw new Error(`Прошивка №${id} не найдена`)
    return rec
  }

  return {
    dir,

    async list() {
      await load()
      return [...state.records].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
    },

    save(meta, data, eeprom) {
      return serial(async () => {
        if (!meta || typeof meta.name !== 'string' || !meta.name.trim()) throw new Error('Нужно название прошивки')
        if (!(data instanceof Uint8Array)) throw new Error('Неверные данные прошивки')
        await load()
        const base = safeFileName(meta.name)
        const file = await uniqueName(base, '.bin')
        await writeAtomic(path.join(dir, file), data)
        let eepromFile
        if (eeprom instanceof Uint8Array) {
          eepromFile = await uniqueName(`${base}_eeprom`, '.bin')
          await writeAtomic(path.join(dir, eepromFile), eeprom)
        }
        const record = { note: '' }
        for (const k of META_FIELDS) if (meta[k] !== undefined) record[k] = meta[k]
        Object.assign(record, {
          id: state.nextId++,
          size: data.length,
          createdAt: now().getTime(),
          hasEeprom: eepromFile !== undefined,
          file,
          ...(eepromFile ? { eepromFile } : {}),
        })
        state.records.push(record)
        await persist()
        return record
      })
    },

    async read(id) {
      await load()
      const rec = state.records.find((r) => r.id === id)
      if (!rec) return null
      try {
        const data = new Uint8Array(await fs.readFile(path.join(dir, rec.file)))
        const eeprom = rec.eepromFile ? new Uint8Array(await fs.readFile(path.join(dir, rec.eepromFile)).catch(() => Buffer.alloc(0))) : undefined
        return eeprom && eeprom.length ? { data, eeprom } : { data }
      } catch (e) {
        if (e && e.code === 'ENOENT') return null
        throw e
      }
    },

    update(id, patch) {
      return serial(async () => {
        await load()
        const rec = find(id)
        if (typeof patch.note === 'string') rec.note = patch.note
        if (typeof patch.name === 'string' && patch.name.trim() && patch.name !== rec.name) {
          rec.name = patch.name.trim()
          const base = safeFileName(rec.name)
          const renameTo = async (from, ext, suffix) => {
            const to = await uniqueName(`${base}${suffix}`, ext, from)
            if (to !== from) await fs.rename(path.join(dir, from), path.join(dir, to)).catch((e) => { if (e.code !== 'ENOENT') throw e })
            return to
          }
          rec.file = await renameTo(rec.file, '.bin', '')
          if (rec.eepromFile) rec.eepromFile = await renameTo(rec.eepromFile, '.bin', '_eeprom')
        }
        await persist()
        return { ...rec }
      })
    },

    remove(id) {
      return serial(async () => {
        await load()
        const rec = find(id)
        for (const f of [rec.file, rec.eepromFile]) {
          if (f && (await exists(path.join(dir, f)))) await trash(path.join(dir, f))
        }
        state.records = state.records.filter((r) => r.id !== id)
        await persist()
      })
    },

    async folderInfo() {
      await load()
      let bytes = 0
      for (const r of state.records) {
        for (const f of [r.file, r.eepromFile]) {
          if (f) bytes += await fs.stat(path.join(dir, f)).then((s) => s.size, () => 0)
        }
      }
      return { path: dir, count: state.records.length, bytes }
    },

    async filePath(id) {
      await load()
      const rec = state.records.find((r) => r.id === id)
      if (!rec) return null
      const p = path.join(dir, rec.file)
      return (await exists(p)) ? p : null
    },
  }
}
```

В корневом `.gitignore` добавить строки `firmware-site/Прошивки/` и `firmware-site/dist-app/`.

- [ ] **Step 4: Тесты проходят**

Run: `npx vitest run tests/electron`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add .gitignore firmware-site && git commit -m "feat: хранилище прошивок в папке рядом с программой"
```

---

### Task 3: Библиотека интерфейса через мост, «Сохранить как…», «Показать в папке»

**Files:**
- Create: `src/bridge.ts`, `src/library/types.ts` (вместо `db.ts`), `src/library/useLibrary.ts`, `src/lib/saveFile.ts` (вместо `download.ts`), `src/ui/library/recordFiles.ts` (вместо `downloadRecord.ts`), `tests/helpers/fakeBridge.ts`
- Delete: `src/library/db.ts`, `src/lib/download.ts`, `src/ui/library/downloadRecord.ts`
- Modify: `src/library/library.ts`, `src/library/identify.ts`, `src/analysis/analyze.ts`, `src/flash/compat.ts` (импорт `DumpKind` из `types`), `src/ui/pages/DevicePage.tsx`, `LibraryPage.tsx`, `AnalysisPage.tsx`, `FlashPage.tsx`, `src/ui/analysis/SummaryTab.tsx`, `src/ui/library/ImportButton.tsx`
- Test: `tests/library/library.test.ts` (переписать), `tests/library/naming.test.ts` (перенести `defaultName`)
- `package.json`: удалить `dexie`, `dexie-react-hooks`, `fake-indexeddb`

**Interfaces:**
- Consumes: `createLibraryStore` (Task 2) — только в тестах, через фальшивый мост.
- Produces:
  - `src/bridge.ts`: `PortChoice { portId; portName; displayName?; vendorId?; productId? }`, `PaulukBridge` (как в spec §4, кроме `PortChoice.label` — см. Ruling Task 4), `bridge(): PaulukBridge`
  - `src/library/types.ts`: `DumpKind`, `FirmwareRecord` (+ `file: string; eepromFile?: string`), `FirmwareBlob { id; data; eeprom? }`
  - `src/library/library.ts`: `saveFirmware`, `listFirmware`, `getFirmware`, `getFirmwareData(id): Promise<FirmwareBlob | undefined>`, `updateFirmware`, `deleteFirmware`, `libraryFolder()`, `openLibraryFolder()`, `showFirmwareInFolder(id)`, `subscribeLibrary(fn): () => void`, `KIND_LABELS`, `kindLabel`
  - `useLibrary(): FirmwareRecord[]`
  - `saveFile(defaultName: string, data: Uint8Array | string): Promise<void>`
  - `saveRecordAs(rec, format: 'bin' | 'hex' | 'eeprom'): Promise<void>`, `formatDate(ts)`
  - Сообщение при пропавшем файле: `MISSING_FILE = 'Файл прошивки не найден в папке — его удалили или переименовали вручную'`

- [ ] **Step 1: Мост и фальшивый мост для тестов**

`src/bridge.ts`:

```ts
import type { FirmwareRecord } from '@/library/types'

/** Порт из списка Electron. vendorId/productId — десятичные строки (так их отдаёт Electron). */
export interface PortChoice {
  portId: string
  portName: string
  displayName?: string
  vendorId?: string
  productId?: string
}

export type NewFirmwareMeta = Omit<FirmwareRecord, 'id' | 'size' | 'createdAt' | 'hasEeprom' | 'file' | 'eepromFile' | 'note'> & { note?: string }

export interface PaulukBridge {
  library: {
    list(): Promise<FirmwareRecord[]>
    save(meta: NewFirmwareMeta, data: Uint8Array, eeprom?: Uint8Array): Promise<FirmwareRecord>
    read(id: number): Promise<{ data: Uint8Array; eeprom?: Uint8Array } | null>
    update(id: number, patch: { name?: string; note?: string }): Promise<FirmwareRecord>
    remove(id: number): Promise<void>
    folder(): Promise<{ path: string; bytes: number; count: number }>
    openFolder(): Promise<void>
    showInFolder(id: number): Promise<void>
  }
  files: {
    saveAs(defaultName: string, data: Uint8Array | string): Promise<'saved' | 'cancelled'>
  }
  ports: {
    onRequest(cb: (ports: PortChoice[]) => void): () => void
    choose(portId: string | null): void
  }
  app: {
    ready(): void
  }
}

declare global {
  interface Window {
    pauluk?: PaulukBridge
  }
}

export function bridge(): PaulukBridge {
  const b = (globalThis as { pauluk?: PaulukBridge }).pauluk
  if (!b) throw new Error('Мост программы недоступен: запустите «Прошивки Паулюкевичуса», а не страницу в браузере')
  return b
}
```

`tests/helpers/fakeBridge.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLibraryStore } from '../../electron/libraryStore.mjs'
import type { PaulukBridge, PortChoice } from '@/bridge'

/** Настоящее хранилище во временной папке за фальшивым мостом — как в программе, только без Electron. */
export async function installFakeBridge() {
  const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'pauluk-ui-')), 'Прошивки')
  let clock = 1
  const store = createLibraryStore(dir, { now: () => new Date(clock++ * 1000), trash: (p: string) => rm(p) })
  const chosen: (string | null)[] = []
  const saved: { name: string; data: Uint8Array | string }[] = []
  const shown: number[] = []
  let portListener: ((p: PortChoice[]) => void) | null = null
  const b: PaulukBridge = {
    library: {
      list: () => store.list(),
      save: (meta, data, eeprom) => store.save(meta, data, eeprom),
      read: (id) => store.read(id),
      update: (id, patch) => store.update(id, patch),
      remove: (id) => store.remove(id),
      folder: () => store.folderInfo(),
      openFolder: async () => {},
      showInFolder: async (id) => { shown.push(id) },
    },
    files: { saveAs: async (name, data) => { saved.push({ name, data }); return 'saved' } },
    ports: {
      onRequest: (cb) => { portListener = cb; return () => { portListener = null } },
      choose: (id) => { chosen.push(id) },
    },
    app: { ready: () => {} },
  }
  ;(globalThis as { pauluk?: PaulukBridge }).pauluk = b
  return {
    dir,
    chosen,
    saved,
    shown,
    offerPorts: (p: PortChoice[]) => portListener?.(p),
    cleanup: async () => {
      delete (globalThis as { pauluk?: PaulukBridge }).pauluk
      await rm(path.dirname(dir), { recursive: true, force: true })
    },
  }
}
```

- [ ] **Step 2: Падающие тесты библиотеки**

`tests/library/library.test.ts` (полностью заменить):

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
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

  it('подписи типа дампа', () => {
    expect(kindLabel({ kind: 'full' })).toBe('Вся flash')
    expect(kindLabel({ kind: 'partition', partitionLabel: 'nvs' })).toBe('Раздел nvs')
  })
})
```

`tests/library/naming.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { defaultName } from '@/library/naming'

describe('defaultName', () => {
  it('чип, имя проекта и время, без запрещённых в Windows символов', () => {
    const d = new Date(2026, 8, 30, 15, 7)
    expect(defaultName('ESP32-S3', 'blink', d)).toBe('ESP32-S3_blink_2026-09-30_15-07')
    expect(defaultName('ATmega328P', undefined, d)).toBe('ATmega328P_firmware_2026-09-30_15-07')
    expect(defaultName('ESP32', 'my app:v2', d)).toBe('ESP32_my_app_v2_2026-09-30_15-07')
  })
})
```

Run: `npx vitest run tests/library`
Expected: FAIL — `library.ts` ещё на Dexie: `subscribeLibrary`/`libraryFolder` не экспортируются.

- [ ] **Step 3: Типы и библиотека через мост**

`git mv src/library/db.ts src/library/types.ts`, затем заменить содержимое `src/library/types.ts`:

```ts
import type { Family } from '@/drivers/types'

export type DumpKind = 'full' | 'app' | 'partition'

export interface FirmwareRecord {
  id: number
  name: string
  family: Family
  chip: string
  kind: DumpKind
  partitionLabel?: string
  baseAddress: number
  size: number
  sha256: string
  createdAt: number
  note: string
  source: 'board' | 'file'
  appName?: string
  appVersion?: string
  hasEeprom: boolean
  /** Имя файла прошивки в папке «Прошивки». */
  file: string
  eepromFile?: string
}

export interface FirmwareBlob {
  id: number
  data: Uint8Array
  eeprom?: Uint8Array
}
```

Во всех файлах заменить `from '@/library/db'` и `from './db'` на `from '@/library/types'` / `from './types'` (`src/analysis/analyze.ts`, `src/flash/compat.ts`, `src/library/identify.ts`, `src/library/library.ts`).

`src/library/library.ts` (полностью заменить):

```ts
import { sha256Hex } from '@/analysis/hash'
import { bridge } from '@/bridge'
import type { Family } from '@/drivers/types'
import type { DumpKind, FirmwareBlob, FirmwareRecord } from './types'

export type { DumpKind, FirmwareBlob, FirmwareRecord }

export const MISSING_FILE = 'Файл прошивки не найден в папке — его удалили или переименовали вручную'

export interface NewFirmware {
  name: string
  family: Family
  chip: string
  kind: DumpKind
  partitionLabel?: string
  baseAddress: number
  data: Uint8Array
  eeprom?: Uint8Array
  note?: string
  source: 'board' | 'file'
  appName?: string
  appVersion?: string
}

const listeners = new Set<() => void>()
const changed = () => listeners.forEach((fn) => fn())

export function subscribeLibrary(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export async function saveFirmware(input: NewFirmware): Promise<FirmwareRecord> {
  const { data, eeprom, ...meta } = input
  const rec = await bridge().library.save({ ...meta, sha256: await sha256Hex(data) }, data, eeprom)
  changed()
  return rec
}

export function listFirmware(): Promise<FirmwareRecord[]> {
  return bridge().library.list()
}

export async function getFirmware(id: number): Promise<FirmwareRecord | undefined> {
  return (await listFirmware()).find((r) => r.id === id)
}

export async function getFirmwareData(id: number): Promise<FirmwareBlob | undefined> {
  const blob = await bridge().library.read(id)
  return blob ? { id, ...blob } : undefined
}

export async function updateFirmware(id: number, patch: Partial<Pick<FirmwareRecord, 'name' | 'note'>>): Promise<void> {
  await bridge().library.update(id, patch)
  changed()
}

export async function deleteFirmware(id: number): Promise<void> {
  await bridge().library.remove(id)
  changed()
}

export const libraryFolder = () => bridge().library.folder()
export const openLibraryFolder = () => bridge().library.openFolder()
export const showFirmwareInFolder = (id: number) => bridge().library.showInFolder(id)

export const KIND_LABELS: Record<DumpKind, string> = {
  full: 'Вся flash',
  app: 'Приложение',
  partition: 'Раздел',
}

export function kindLabel(r: Pick<FirmwareRecord, 'kind' | 'partitionLabel'>): string {
  return r.kind === 'partition' && r.partitionLabel ? `Раздел ${r.partitionLabel}` : KIND_LABELS[r.kind]
}
```

`src/library/useLibrary.ts`:

```ts
import { useEffect, useState } from 'react'
import { listFirmware, subscribeLibrary, type FirmwareRecord } from './library'

/** Список прошивок, который обновляется после каждого сохранения, переименования и удаления. */
export function useLibrary(): FirmwareRecord[] {
  const [records, setRecords] = useState<FirmwareRecord[]>([])
  useEffect(() => {
    let active = true
    const load = () => void listFirmware().then((r) => active && setRecords(r))
    load()
    const off = subscribeLibrary(load)
    return () => {
      active = false
      off()
    }
  }, [])
  return records
}
```

`src/lib/saveFile.ts`:

```ts
import { bridge } from '@/bridge'

/** Окно Windows «Сохранить как…». */
export async function saveFile(defaultName: string, data: Uint8Array | string): Promise<void> {
  await bridge().files.saveAs(defaultName, data)
}
```

`src/ui/library/recordFiles.ts`:

```ts
import { formatIntelHex } from '@/analysis/intelHex'
import { saveFile } from '@/lib/saveFile'
import { type FirmwareRecord, getFirmwareData, MISSING_FILE } from '@/library/library'

export async function saveRecordAs(rec: FirmwareRecord, format: 'bin' | 'hex' | 'eeprom'): Promise<void> {
  const blob = await getFirmwareData(rec.id)
  if (!blob) throw new Error(MISSING_FILE)
  if (format === 'hex') await saveFile(`${rec.name}.hex`, formatIntelHex(blob.data, rec.baseAddress))
  else if (format === 'eeprom') {
    if (blob.eeprom) await saveFile(`${rec.name}_eeprom.bin`, blob.eeprom)
  } else await saveFile(`${rec.name}.bin`, blob.data)
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}
```

Удалить `src/lib/download.ts` и `src/ui/library/downloadRecord.ts`; `npm uninstall dexie dexie-react-hooks fake-indexeddb`.

- [ ] **Step 4: Тесты библиотеки проходят**

Run: `npx vitest run tests/library`
Expected: PASS.

- [ ] **Step 5: Экраны — на новую библиотеку**

Правила замены во всех экранах:
- `import { useLiveQuery } from 'dexie-react-hooks'` → `import { useLibrary } from '@/library/useLibrary'`; `useLiveQuery(listFirmware, [], [] as FirmwareRecord[])` → `useLibrary()`.
- `downloadRecord(r, fmt)` → `saveRecordAs(r, fmt)` из `../library/recordFiles`; `formatDate` — оттуда же.
- `downloadBytes(x, name)` → `void saveFile(name, x)` из `@/lib/saveFile`.
- Подписи кнопок: «Скачать .bin» → «Сохранить .bin», «Скачать .hex» → «Сохранить .hex», «Скачать EEPROM» → «Сохранить EEPROM», title «Скачать .bin» → «Сохранить .bin как…»; иконка `Download` → `Save` (lucide).
- Где есть запись (`record`/`r`): кнопка «Показать в папке» — `FolderOpen`, `onClick={() => void showFirmwareInFolder(r.id)}`.

`src/ui/pages/LibraryPage.tsx`:
- Заголовок: рядом с `<ImportButton />` кнопка `<Button variant="outline" onClick={() => void openLibraryFolder()}><FolderOpen className="size-4" /> Открыть папку</Button>`.
- Нижняя строка вместо `storageEstimate`:

```tsx
const [folder, setFolder] = useState<{ path: string; bytes: number; count: number } | null>(null)
useEffect(() => { void libraryFolder().then(setFolder) }, [records])
// ...
{folder && (
  <p className="text-xs break-all text-muted-foreground">
    Папка: {folder.path} · {folder.count} прошивок · {formatSize(folder.bytes)}. Файлы можно копировать и переносить вместе с программой.
  </p>
)}
```

- В действиях строки добавить `<Button variant="ghost" size="icon" title="Показать в папке" aria-label="Показать в папке" onClick={() => void showFirmwareInFolder(r.id)}><FolderOpen className="size-4" /></Button>`.
- Текст подтверждения удаления: «Запись исчезнет из Библиотеки, файлы прошивки уйдут в Корзину Windows.»
- Ошибка «Сохранить как…» (пропавший файл): обернуть вызовы `saveRecordAs` в `run`-обёртку страницы:

```tsx
const [error, setError] = useState<ExplainedError | null>(null)
const act = (fn: () => Promise<void>) => void fn().then(() => setError(null), (e) => setError(explainError(e)))
// onClick={() => act(() => saveRecordAs(r, 'bin'))}
// под таблицей: {error && <ErrorCallout error={error} />}
```

`src/ui/pages/AnalysisPage.tsx`: `Picker` — `useLibrary()`; кнопки «.bin»/«.hex» → `act(() => saveRecordAs(record, …))` с тем же `error`/`ErrorCallout`; добавить «Показать в папке». Если `getFirmwareData` вернул `undefined`, а запись есть — показывать `MISSING_FILE` вместо «Прошивка не найдена — возможно, её удалили»:

```tsx
void Promise.all([getFirmware(id), getFirmwareData(id)]).then(([record, blob]) => {
  if (!active) return
  setLoaded(!record ? 'missing' : !blob ? 'no-file' : { record, data: blob.data })
})
// тип: type Loaded = { record: FirmwareRecord; data: Uint8Array } | 'missing' | 'no-file' | null
// 'no-file' → <Panel title="Анализ"><p className="text-sm">{MISSING_FILE}.</p></Panel>
```

`src/ui/pages/FlashPage.tsx`: `useLibrary()`; при `!blob` — `setError({ title: MISSING_FILE, raw: '' })`.

`src/ui/pages/DevicePage.tsx` (`ResultPanel`): кнопки через `saveFile`; при наличии `record` — «Показать в папке»; строка «Сохранено в Библиотеку.» → «Сохранено в папку «Прошивки».».

`src/ui/analysis/SummaryTab.tsx`: `formatDate` из `../library/recordFiles`.

- [ ] **Step 6: Проверки**

Run: `npx vitest run && npx tsc -p tsconfig.app.json --noEmit && npm run lint`
Expected: все тесты PASS, типы без ошибок, 0 errors в ESLint.

- [ ] **Step 7: Commit**

```bash
cd .. && git add -A firmware-site && git commit -m "feat: библиотека через мост программы, «Сохранить как…» и «Показать в папке»"
```

---

### Task 4: Окно выбора COM-порта

**Files:**
- Modify: `src/serial/portName.ts` (+ `describeElectronPort`)
- Create: `src/state/portPicker.ts`, `src/ui/layout/PortPickerDialog.tsx`
- Modify: `src/state/ConnectionContext.tsx` (подпись порта из выбора), `src/ui/layout/AppShell.tsx` (диалог)
- Test: `tests/serial/portName.test.ts` (дополнить), `tests/state/portPicker.test.ts`

**Interfaces:**
- Consumes: `PortChoice`, `bridge()` (Task 3); `installFakeBridge` (Task 3).
- Produces:
  - `describeElectronPort(p: PortChoice): string` → `«COM5 · CH340 · USB 1A86:7523»`
  - `portPicker`: `initPortPicker(): () => void`, `getPickerPorts(): PortChoice[] | null`, `subscribePicker(fn): () => void`, `choosePort(p: PortChoice | null): void`, `takeLastChosen(): PortChoice | null`
  - `PortPickerDialog()`
- Отступление от spec §4/§6 (записать в журнал как Ruling): `PortChoice` не несёт готовую `label`, а `electron/ports.cjs` не создаётся — подпись строит интерфейс функцией `describeElectronPort` рядом с таблицей адаптеров `KNOWN_ADAPTERS`, чтобы таблица была одна. Main-процесс пересылает сырые поля порта.

- [ ] **Step 1: Падающие тесты**

В `tests/serial/portName.test.ts` добавить:

```ts
import { describeElectronPort } from '@/serial/portName'

describe('describeElectronPort', () => {
  it('COM-номер, адаптер и USB (Electron отдаёт VID/PID десятичными строками)', () => {
    expect(describeElectronPort({ portId: '1', portName: 'COM5', displayName: 'USB-SERIAL CH340', vendorId: '6790', productId: '29987' })).toBe('COM5 · CH340 · USB 1A86:7523')
    expect(describeElectronPort({ portId: '2', portName: 'COM7', displayName: 'Silicon Labs CP210x USB to UART Bridge', vendorId: '4292', productId: '60000' })).toBe('COM7 · CP2102 · USB 10C4:EA60')
  })

  it('неизвестный адаптер — имя от Windows; порт без USB', () => {
    expect(describeElectronPort({ portId: '3', portName: 'COM9', displayName: 'Мой адаптер', vendorId: '4660', productId: '22136' })).toBe('COM9 · Мой адаптер · USB 1234:5678')
    expect(describeElectronPort({ portId: '4', portName: 'COM1', displayName: 'Communications Port' })).toBe('COM1 · Communications Port')
    expect(describeElectronPort({ portId: '5', portName: 'COM3' })).toBe('COM3')
  })
})
```

`tests/state/portPicker.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { choosePort, getPickerPorts, initPortPicker, subscribePicker, takeLastChosen } from '@/state/portPicker'
import { installFakeBridge } from '../helpers/fakeBridge'

let env: Awaited<ReturnType<typeof installFakeBridge>>
let stop: () => void
beforeEach(async () => { env = await installFakeBridge(); stop = initPortPicker() })
afterEach(async () => { stop(); await env.cleanup() })

const com5 = { portId: 'a', portName: 'COM5', vendorId: '6790', productId: '29987' }
const com7 = { portId: 'b', portName: 'COM7' }

describe('portPicker', () => {
  it('показывает список по запросу и обновляет его, пока окно открыто', () => {
    let calls = 0
    const off = subscribePicker(() => calls++)
    env.offerPorts([com5])
    expect(getPickerPorts()).toEqual([com5])
    env.offerPorts([com5, com7]) // плату подключили при открытом окне
    expect(getPickerPorts()).toHaveLength(2)
    off()
    expect(calls).toBe(2)
  })

  it('выбор отдаёт portId в программу и запоминается для подписи', () => {
    env.offerPorts([com5, com7])
    choosePort(com7)
    expect(env.chosen).toEqual(['b'])
    expect(getPickerPorts()).toBeNull()
    expect(takeLastChosen()).toEqual(com7)
    expect(takeLastChosen()).toBeNull()
  })

  it('закрыли окно — запрос отменяется', () => {
    env.offerPorts([com5])
    choosePort(null)
    expect(env.chosen).toEqual([null])
    expect(takeLastChosen()).toBeNull()
  })
})
```

Run: `npx vitest run tests/serial/portName.test.ts tests/state/portPicker.test.ts`
Expected: FAIL — `describeElectronPort` не экспортируется, `@/state/portPicker` не найден.

- [ ] **Step 2: Реализовать подпись и хранилище выбора**

В `src/serial/portName.ts` добавить (использует существующие `KNOWN_ADAPTERS` и `hex4`):

```ts
import type { PortChoice } from '@/bridge'

/** Подпись порта в окне выбора: «COM5 · CH340 · USB 1A86:7523». */
export function describeElectronPort(p: PortChoice): string {
  const parts = [p.portName]
  const vid = p.vendorId !== undefined ? Number(p.vendorId) : NaN
  const pid = p.productId !== undefined ? Number(p.productId) : NaN
  if (Number.isFinite(vid) && Number.isFinite(pid)) {
    const key = `${hex4(vid)}:${hex4(pid)}`
    parts.push(KNOWN_ADAPTERS[key] ?? p.displayName ?? 'USB-адаптер', `USB ${key}`)
  } else if (p.displayName) {
    parts.push(p.displayName)
  }
  return parts.join(' · ')
}
```

`src/state/portPicker.ts`:

```ts
import { bridge, type PortChoice } from '@/bridge'

/**
 * Окно выбора порта: navigator.serial.requestPort() в программе приходит сюда списком
 * портов с именами (COM5), пользователь выбирает, выбор уходит обратно в Electron.
 */
let ports: PortChoice[] | null = null
let lastChosen: PortChoice | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export function initPortPicker(): () => void {
  return bridge().ports.onRequest((list) => {
    ports = list
    emit()
  })
}

export function getPickerPorts(): PortChoice[] | null {
  return ports
}

export function subscribePicker(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function choosePort(p: PortChoice | null): void {
  lastChosen = p
  ports = null
  emit()
  bridge().ports.choose(p?.portId ?? null)
}

/** Какой порт выбрали последним — для подписи «Подключено · COM5 · …». */
export function takeLastChosen(): PortChoice | null {
  const p = lastChosen
  lastChosen = null
  return p
}
```

Run: `npx vitest run tests/serial/portName.test.ts tests/state/portPicker.test.ts`
Expected: PASS.

- [ ] **Step 3: Диалог и подключение**

`src/ui/layout/PortPickerDialog.tsx`:

```tsx
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Usb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { describeElectronPort } from '@/serial/portName'
import { choosePort, getPickerPorts, initPortPicker, subscribePicker } from '@/state/portPicker'
import { StatusDot } from '../components/StatusDot'

export function PortPickerDialog() {
  useEffect(() => initPortPicker(), [])
  const ports = useSyncExternalStore(subscribePicker, getPickerPorts)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!ports) setSelected(null)
    else if (ports.length === 1) setSelected(ports[0].portId)
    else if (selected && !ports.some((p) => p.portId === selected)) setSelected(null)
  }, [ports, selected])

  const confirm = () => choosePort(ports?.find((p) => p.portId === selected) ?? null)

  return (
    <Dialog open={ports !== null} onOpenChange={(open) => !open && choosePort(null)}>
      <DialogContent className="rounded-[20px]">
        <DialogHeader>
          <DialogTitle>Выберите порт</DialogTitle>
          <DialogDescription>Список обновляется сам, когда плату подключают или отключают.</DialogDescription>
        </DialogHeader>
        {ports && ports.length === 0 ? (
          <div className="flex items-center gap-3 rounded-[10px] border p-4 text-sm text-muted-foreground">
            <Usb className="size-4 shrink-0" /> Подключите плату по USB — она появится здесь.
          </div>
        ) : (
          <div className="grid gap-1.5" role="listbox" aria-label="Порты">
            {ports?.map((p) => (
              <button
                key={p.portId}
                type="button"
                role="option"
                aria-selected={selected === p.portId}
                onClick={() => setSelected(p.portId)}
                onDoubleClick={() => choosePort(p)}
                className={cn('flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent', selected === p.portId && 'border-ring bg-accent')}
              >
                <StatusDot tone={selected === p.portId ? 'ok' : 'idle'} />
                <span className="min-w-0 break-words">{describeElectronPort(p)}</span>
              </button>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => choosePort(null)}>Отмена</Button>
          <Button onClick={confirm} disabled={!selected}>Выбрать</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

`src/ui/layout/AppShell.tsx`: импортировать `PortPickerDialog` и отрендерить `<PortPickerDialog />` рядом с `<ThemeDialog … />`.

`src/state/ConnectionContext.tsx`:
- импорт `import { describeElectronPort, describePort } from '@/serial/portName'` и `import { takeLastChosen } from './portPicker'`;
- `const portLabelRef = useRef('')`;
- `connect` принимает подпись: `async (port: SerialPort, portLabel: string) => { … }` (строку `const portLabel = describePort(port.getInfo())` убрать);
- в `choosePort` после успешного `requestPort`:

```tsx
    const chosen = takeLastChosen()
    const portLabel = chosen ? describeElectronPort(chosen) : describePort(port.getInfo())
    await disconnect()
    portRef.current = port
    portLabelRef.current = portLabel
    setHasPort(true)
    await connect(port, portLabel)
```

- в `reconnect`: `await connect(port, portLabelRef.current || describePort(port.getInfo()))`.

- [ ] **Step 4: Проверки**

Run: `npx vitest run && npx tsc -p tsconfig.app.json --noEmit && npm run lint`
Expected: PASS, 0 errors.

- [ ] **Step 5: Commit**

```bash
cd .. && git add -A firmware-site && git commit -m "feat: окно выбора COM-порта с именами портов"
```

---

### Task 5: Electron — окна, заставка, мост, выбор порта; убрать «сайтовое»

**Files:**
- Create: `electron/app.mjs`, `electron/main.mjs`, `electron/preload.cjs`, `electron/splash.html`, `electron/smoke.mjs`
- Modify: `package.json` (`main`, скрипты, `electron` в devDependencies), `vite.config.ts` (`base: './'`), `index.html` (`./icon.png`), `src/ui/layout/Sidebar.tsx` (`./icon.png`), `src/App.tsx`, `src/main.tsx`
- Delete: `src/ui/layout/UnsupportedBrowser.tsx`, `start.bat`, `.claude/launch.json` (корень репозитория — предпросмотр сайта больше не нужен)

**Interfaces:**
- Consumes: `createLibraryStore`, `dataDir` (Task 2); мост `PaulukBridge` (Task 3) — preload реализует ровно его.
- Produces: `startApp(): Promise<{ main: BrowserWindow; shown: Promise<void> } | null>`; IPC-каналы `library:*`, `files:saveAs`, `ports:request` (main→renderer), `ports:choose`, `app:ready`.

- [ ] **Step 1: Поставить Electron и настроить сборку интерфейса**

```bash
npm install -D electron@39
```

`vite.config.ts`: добавить в объект конфигурации `base: './',`. `index.html`: `href="./icon.png"`. `Sidebar.tsx`: `src="./icon.png"`.

`package.json` → в корень объекта: `"main": "electron/main.mjs"`, в `scripts`: `"app": "npm run build && electron ."`, `"smoke": "npm run build && electron electron/smoke.mjs"`.

- [ ] **Step 2: Preload — мост**

`electron/preload.cjs`:

```js
/** Мост «интерфейс ↔ программа»: только эти функции видны окну, диск и система — нет. */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pauluk', {
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    save: (meta, data, eeprom) => ipcRenderer.invoke('library:save', meta, data, eeprom),
    read: (id) => ipcRenderer.invoke('library:read', id),
    update: (id, patch) => ipcRenderer.invoke('library:update', id, patch),
    remove: (id) => ipcRenderer.invoke('library:remove', id),
    folder: () => ipcRenderer.invoke('library:folder'),
    openFolder: () => ipcRenderer.invoke('library:openFolder'),
    showInFolder: (id) => ipcRenderer.invoke('library:showInFolder', id),
  },
  files: {
    saveAs: (defaultName, data) => ipcRenderer.invoke('files:saveAs', defaultName, data),
  },
  ports: {
    onRequest: (cb) => {
      const handler = (_event, list) => cb(list)
      ipcRenderer.on('ports:request', handler)
      return () => ipcRenderer.removeListener('ports:request', handler)
    },
    choose: (portId) => ipcRenderer.send('ports:choose', portId),
  },
  app: {
    ready: () => ipcRenderer.send('app:ready'),
  },
})
```

- [ ] **Step 3: Заставка**

`electron/splash.html`:

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'self' file:; style-src 'unsafe-inline' file:; script-src 'unsafe-inline'; font-src file:; img-src file:" />
<style>
  @font-face { font-family: "JetBrains Mono"; src: url("../src/assets/fonts/JetBrainsMono-Medium.ttf") format("truetype"); font-weight: 500; }
  :root { --bg: #FFFFFF; --fg: #09090B; --muted: #71717A; --line: #E4E4E7; --accent: #FABD2F; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141417; --fg: #FAFAFA; --muted: #A1A1AA; --line: #27272A; } }
  html, body { margin: 0; height: 100%; background: transparent; font-family: "JetBrains Mono", ui-monospace, monospace; color: var(--fg); overflow: hidden; user-select: none; }
  .card { position: absolute; inset: 12px; border-radius: 28px; background: var(--bg); border: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 28px 60px -16px rgba(0,0,0,.45); }
  .stage { position: relative; width: 120px; height: 120px; display: grid; place-items: center; perspective: 600px; }
  .halo { position: absolute; width: 88px; height: 88px; border-radius: 50%; background: var(--accent); opacity: .25; animation: halo 1.4s ease-out infinite; }
  .logo { width: 88px; height: 88px; animation: flip 1.5s cubic-bezier(.68,-.55,.27,1.55) infinite; }
  @keyframes flip { 0%, 30% { transform: rotateY(0) } 50%, 80% { transform: rotateY(180deg) } 100% { transform: rotateY(360deg) } }
  @keyframes halo { 0% { transform: scale(1); opacity: .35 } 100% { transform: scale(1.6); opacity: 0 } }
  .title { margin-top: 18px; font-size: 14px; font-weight: 500; }
  .percent { margin-top: 14px; font-size: 30px; font-weight: 500; }
  .bar { width: 220px; height: 4px; border-radius: 4px; background: var(--line); margin-top: 10px; overflow: hidden; }
  .fill { height: 100%; width: 0; background: var(--accent); border-radius: 4px; }
  .step { margin-top: 10px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .12em; }
</style>
</head>
<body>
  <div class="card">
    <div class="stage"><div class="halo"></div><img class="logo" src="../dist/icon.png" alt="" /></div>
    <div class="title">Прошивки Паулюкевичуса</div>
    <div class="percent" id="percent">0%</div>
    <div class="bar"><div class="fill" id="fill"></div></div>
    <div class="step" id="step">Запускаю</div>
  </div>
<script>
  // Как в Студии: проценты догоняют реальные шаги запуска по 1 % за 18 мс.
  let target = 0, shown = 0, label = 'Запускаю'
  const percentEl = document.getElementById('percent'), fillEl = document.getElementById('fill'), stepEl = document.getElementById('step')
  function render() { percentEl.textContent = shown + '%'; fillEl.style.width = shown + '%'; stepEl.textContent = label }
  window.setStep = (pct, text) => { target = Math.max(target, pct); if (text) label = text }
  window.finish = () => new Promise((resolve) => {
    window.setStep(100, 'Готово')
    const wait = () => (shown >= 100 ? setTimeout(resolve, 150) : setTimeout(wait, 30))
    wait()
  })
  setInterval(() => { if (shown < target) { shown++; render() } }, 18)
  render()
</script>
</body>
</html>
```

- [ ] **Step 4: Главный процесс**

`electron/app.mjs`:

```js
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from './dataDir.mjs'
import { createLibraryStore } from './libraryStore.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const SPLASH_TIMEOUT = 15_000

function createSplash() {
  const win = new BrowserWindow({
    width: 360, height: 360, frame: false, transparent: true, resizable: false, alwaysOnTop: true,
    skipTaskbar: true, show: false, center: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.loadFile(path.join(here, 'splash.html'))
  win.once('ready-to-show', () => win.show())
  return win
}

function createMain() {
  return new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 520, show: false,
    title: 'Прошивки Паулюкевичуса',
    icon: path.join(root, 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0A0A0B' : '#FAFAFA',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
}

function registerLibrary(getMain) {
  const dir = path.join(dataDir({ env: process.env, isPackaged: app.isPackaged, execPath: process.execPath, devRoot: root }), 'Прошивки')
  const store = createLibraryStore(dir, { trash: (p) => shell.trashItem(p), log: (m) => console.warn(m) })
  ipcMain.handle('library:list', () => store.list())
  ipcMain.handle('library:save', (_e, meta, data, eeprom) => store.save(meta, data, eeprom))
  ipcMain.handle('library:read', (_e, id) => store.read(Number(id)))
  ipcMain.handle('library:update', (_e, id, patch) => store.update(Number(id), patch ?? {}))
  ipcMain.handle('library:remove', (_e, id) => store.remove(Number(id)))
  ipcMain.handle('library:folder', () => store.folderInfo())
  ipcMain.handle('library:openFolder', async () => { await store.list(); await shell.openPath(store.dir) })
  ipcMain.handle('library:showInFolder', async (_e, id) => {
    const p = await store.filePath(Number(id))
    if (p) shell.showItemInFolder(p)
    else await shell.openPath(store.dir)
  })
  ipcMain.handle('files:saveAs', async (_e, defaultName, data) => {
    const name = String(defaultName)
    const isHex = /\.hex$/i.test(name)
    const result = await dialog.showSaveDialog(getMain(), {
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: [isHex ? { name: 'Intel HEX', extensions: ['hex'] } : { name: 'Прошивка', extensions: ['bin'] }],
    })
    if (result.canceled || !result.filePath) return 'cancelled'
    await writeFile(result.filePath, typeof data === 'string' ? data : Buffer.from(data))
    return 'saved'
  })
}

/** Web Serial в Electron: вместо системного окна Chrome — наше окно со списком «COM5 · …». */
function registerSerial(getMain) {
  let pending = null
  let ports = []
  const toChoice = (p) => ({ portId: p.portId, portName: p.portName, displayName: p.displayName, vendorId: p.vendorId, productId: p.productId })
  const send = () => getMain()?.webContents.send('ports:request', ports.map(toChoice))

  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'serial' || permission === 'clipboard-sanitized-write')
  session.defaultSession.setDevicePermissionHandler((details) => details.deviceType === 'serial')
  session.defaultSession.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault()
    pending?.('') // предыдущий запрос, если был, отменяем
    pending = callback
    ports = portList
    send()
  })
  session.defaultSession.on('serial-port-added', (_e, port) => {
    if (!pending) return
    ports = [...ports.filter((p) => p.portId !== port.portId), port]
    send()
  })
  session.defaultSession.on('serial-port-removed', (_e, port) => {
    if (!pending) return
    ports = ports.filter((p) => p.portId !== port.portId)
    send()
  })
  ipcMain.on('ports:choose', (_e, portId) => {
    const cb = pending
    pending = null
    ports = []
    cb?.(typeof portId === 'string' ? portId : '')
  })
}

export async function startApp() {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return null
  }
  await app.whenReady()
  let main = null
  const getMain = () => main
  registerLibrary(getMain)
  registerSerial(getMain)

  const splash = createSplash()
  const step = (pct, text) => splash.isDestroyed() ? Promise.resolve() : splash.webContents.executeJavaScript(`window.setStep(${pct}, ${JSON.stringify(text)})`).catch(() => {})
  splash.webContents.once('did-finish-load', () => step(25, 'Открываю окно'))

  main = createMain()
  main.removeMenu()
  main.loadFile(path.join(root, 'dist', 'index.html'))
  main.once('ready-to-show', () => step(60, 'Загружаю интерфейс'))

  let resolveShown
  const shown = new Promise((r) => { resolveShown = r })
  let finished = false
  const finish = async () => {
    if (finished) return
    finished = true
    if (!splash.isDestroyed()) await splash.webContents.executeJavaScript('window.finish()').catch(() => {})
    if (!splash.isDestroyed()) splash.destroy()
    main.show()
    resolveShown()
  }
  ipcMain.once('app:ready', () => void finish())
  setTimeout(() => void finish(), SPLASH_TIMEOUT)

  app.on('second-instance', () => {
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
  })
  app.on('window-all-closed', () => app.quit())
  return { main, shown }
}
```

`electron/main.mjs`:

```js
import { startApp } from './app.mjs'

void startApp()
```

- [ ] **Step 5: Интерфейс сообщает о готовности, «сайтовое» убрано**

`src/App.tsx` (полностью заменить):

```tsx
import { useEffect } from 'react'
import { bridge } from '@/bridge'
import { listFirmware } from '@/library/library'
import { ConnectionProvider } from '@/state/ConnectionContext'
import { AppShell } from '@/ui/layout/AppShell'

export default function App() {
  // Заставка закрывается, когда интерфейс нарисован и библиотека прочитана.
  useEffect(() => {
    void listFirmware().finally(() => bridge().app.ready())
  }, [])
  return (
    <ConnectionProvider>
      <AppShell />
    </ConnectionProvider>
  )
}
```

Удалить `src/ui/layout/UnsupportedBrowser.tsx`, `start.bat`, корневой `.claude/launch.json`.

- [ ] **Step 6: Дымовой прогон с живыми скриншотами**

`electron/smoke.mjs`:

```js
/** Дымовой прогон: запускает программу, снимает заставку и все экраны в PNG, пишет текст экранов. Не входит в exe. */
import { app } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startApp } from './app.mjs'

const out = path.join(process.env.TEMP ?? '.', 'pauluk-smoke')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const started = await startApp()
await mkdir(out, { recursive: true })
await sleep(600)
for (const win of (await import('electron')).BrowserWindow.getAllWindows()) {
  if (win !== started.main && win.isVisible()) await writeFile(path.join(out, 'splash.png'), (await win.capturePage()).toPNG())
}
await started.shown
const report = []
for (const route of ['device', 'library', 'analysis', 'flash']) {
  await started.main.webContents.executeJavaScript(`location.hash = '#/${route}'`)
  await sleep(700)
  await writeFile(path.join(out, `${route}.png`), (await started.main.webContents.capturePage()).toPNG())
  report.push(`--- ${route}\n` + (await started.main.webContents.executeJavaScript('document.querySelector("main")?.innerText ?? ""')))
}
report.push('--- bridge\n' + (await started.main.webContents.executeJavaScript('typeof window.pauluk + " " + typeof navigator.serial')))
await writeFile(path.join(out, 'report.txt'), report.join('\n'))
console.log('SMOKE OK', out)
app.quit()
```

Run: `npm run smoke`
Expected: в консоли `SMOKE OK <путь>`. Прочитать `report.txt` (все 4 экрана с русским текстом, строка `object object`) и посмотреть `splash.png`, `device.png`, `library.png` (Read). В `library.png` — строка «Папка: …\firmware-site\Прошивки · 0 прошивок». Папка `firmware-site/Прошивки` создана.

- [ ] **Step 7: Проверки**

Run: `npx vitest run && npm run lint`
Expected: PASS, 0 errors.

- [ ] **Step 8: Commit**

```bash
cd .. && git add -A && git commit -m "feat: программа на Electron — окна, заставка, мост, выбор порта"
```

---

### Task 6: Сборка .exe, инструкция, проверка готовой программы

**Files:**
- Modify: `package.json` (блок `build`, runtime-зависимости → `devDependencies`)
- Create: `build_exe.bat`, `packaging/Как установить.txt`
- Modify: `README.md`, `docs/superpowers/specs/2026-09-30-desktop-app-design.md` (статус)

**Interfaces:**
- Produces: `dist-app/Прошивки Паулюкевичуса.exe`, `dist-app/Как установить.txt`.

- [ ] **Step 1: electron-builder**

```bash
npm install -D electron-builder@26
```

В `package.json`: всё из `dependencies` перенести в `devDependencies` (интерфейс собирается Vite в `dist/`, в exe не нужен `node_modules`); добавить:

```json
  "productName": "Прошивки Паулюкевичуса",
  "build": {
    "appId": "ru.pauluk.firmware",
    "productName": "Прошивки Паулюкевичуса",
    "directories": { "output": "dist-app", "buildResources": "build" },
    "files": ["dist/**", "electron/**", "!electron/smoke.mjs", "build/icon.png", "src/assets/fonts/**", "package.json"],
    "win": { "target": "portable", "icon": "build/icon.ico" },
    "portable": { "artifactName": "Прошивки Паулюкевичуса.exe" }
  }
```

- [ ] **Step 2: Скрипт сборки и инструкция**

`build_exe.bat` (UTF-8, CRLF):

```bat
@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Сборка «Прошивки Паулюкевичуса.exe»

if not exist node_modules (
  echo Ставлю зависимости...
  call npm install
  if errorlevel 1 goto :fail
)

echo Собираю интерфейс...
call npm run build
if errorlevel 1 goto :fail

echo Собираю exe (1-3 минуты)...
call npx electron-builder --win portable
if errorlevel 1 goto :fail

copy /y "packaging\Как установить.txt" "dist-app\" >nul

echo.
echo Готово: dist-app\Прошивки Паулюкевичуса.exe
pause
exit /b 0

:fail
echo [ОШИБКА] Сборка не удалась, смотрите сообщения выше.
pause
exit /b 1
```

`packaging/Как установить.txt`:

```text
Прошивки Паулюкевичуса — чтение и заливка прошивок Arduino и ESP32
====================================================================

УСТАНОВКА
1. Положите «Прошивки Паулюкевичуса.exe» в любую постоянную папку,
   например «Документы\Прошивки Паулюкевичуса».
2. Запустите его. Если Windows покажет синее окно «Система Windows защитила
   ваш компьютер» — нажмите «Подробнее» → «Выполнить в любом случае».
   Это обычное предупреждение для программ без платной цифровой подписи.

ГДЕ ХРАНЯТСЯ ПРОШИВКИ
Рядом с программой появится папка «Прошивки»:
  library.json   — список: название, чип, дата, заметка, контрольная сумма
  *.bin          — сами прошивки (обычные файлы, их можно копировать)
Интернет не нужен. Никуда в сеть данные не отправляются.

ПЕРЕНОС НА ДРУГОЙ КОМПЬЮТЕР / РЕЗЕРВНАЯ КОПИЯ
Закройте программу и скопируйте exe вместе с папкой «Прошивки».

ПОДКЛЮЧЕНИЕ ПЛАТЫ
«Выбрать COM-порт» → в списке выберите порт платы (например, COM5 · CH340).
Если порт занят — закройте Arduino IDE / монитор порта.
```

- [ ] **Step 3: Собрать**

Run: `cmd //c build_exe.bat` (или двойной щелчок)
Expected: `Готово: dist-app\Прошивки Паулюкевичуса.exe`, размер ~80–120 МБ. Если electron-builder падает из-за пути с пробелами/кириллицей — собрать копию проекта во временной папке без пробелов (как фикстуру ESP32 в плане сайта) и скопировать оттуда `dist-app/`; решение — в журнал.

- [ ] **Step 4: Проверить готовую программу**

1. Запустить `dist-app\Прошивки Паулюкевичуса.exe`; через 5 с снять экран PowerShell-скриптом (System.Drawing `CopyFromScreen` → PNG во временную папку) и посмотреть (Read): открыто главное окно в стиле Студии, иконка в панели задач — жёлтая с микросхемой.
2. Рядом с exe появилась `dist-app\Прошивки\` (пока пустая).
3. Запустить exe второй раз → новое окно не появляется, процессов программы по-прежнему один набор (`tasklist`).
4. Закрыть программу.

- [ ] **Step 5: README и спецификация**

`README.md` — заменить разделы «Запуск на своём ПК» и «Публикация в интернете» на:

```markdown
## Программа

- `build_exe.bat` — собрать `dist-app\Прошивки Паулюкевичуса.exe` (один переносной файл, как у Студии).
- `npm run app` — собрать интерфейс и открыть программу при разработке.
- `npm run smoke` — дымовой прогон: скриншоты заставки и всех экранов во `%TEMP%\pauluk-smoke`.

Прошивки лежат в папке «Прошивки» рядом с exe (при разработке — `firmware-site\Прошивки`).
```

В спецификации: `Статус: на согласовании` → `Статус: утверждена, реализована`.

- [ ] **Step 6: Commit**

```bash
cd .. && git add -A && git commit -m "build: переносной exe через electron-builder, инструкция по установке"
```
