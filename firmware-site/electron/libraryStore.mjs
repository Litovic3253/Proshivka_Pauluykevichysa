/**
 * Библиотека прошивок в обычной папке: library.json со списком и файлы прошивок рядом.
 * Работает без Electron — Корзина передаётся снаружи (shell.trashItem).
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const INDEX = 'library.json'
const META_FIELDS = ['name', 'family', 'chip', 'kind', 'partitionLabel', 'baseAddress', 'sha256', 'source', 'appName', 'appVersion', 'note']

export function safeFileName(name) {
  // eslint-disable-next-line no-control-regex
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
        const eeprom = rec.eepromFile
          ? new Uint8Array(await fs.readFile(path.join(dir, rec.eepromFile)).catch(() => Buffer.alloc(0)))
          : undefined
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
            if (to !== from) {
              await fs.rename(path.join(dir, from), path.join(dir, to)).catch((e) => {
                if (e.code !== 'ENOENT') throw e
              })
            }
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
