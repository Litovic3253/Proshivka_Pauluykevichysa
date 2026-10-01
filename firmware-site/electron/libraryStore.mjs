/**
 * Библиотека прошивок в обычной папке: library.json со списком и файлы прошивок рядом.
 * Работает без Electron — Корзина передаётся снаружи (shell.trashItem).
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const INDEX = 'library.json'
const META_FIELDS = ['name', 'family', 'chip', 'kind', 'partitionLabel', 'baseAddress', 'sha256', 'source', 'appName', 'appVersion', 'note']
/** Антивирус или OneDrive на миг держат файл — rename поверх него даёт такие ошибки. */
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_ATTEMPTS = 5

export function safeFileName(name) {
  const cleaned = String(name).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/[. ]+$/, '').trim()
  return (cleaned || 'firmware').slice(0, 120)
}

const exists = (p) => fs.access(p).then(() => true, () => false)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const lower = (s) => s.toLowerCase()

/** Имя файла без пути: записи из library.json не должны выводить за пределы папки. */
const isPlainName = (f) => typeof f === 'string' && f.length > 0 && f !== '.' && f !== '..' && path.win32.basename(f) === f && path.posix.basename(f) === f

function isValidRecord(r) {
  return (
    r !== null &&
    typeof r === 'object' &&
    Number.isInteger(r.id) &&
    typeof r.name === 'string' &&
    isPlainName(r.file) &&
    (r.eepromFile === undefined || isPlainName(r.eepromFile))
  )
}

export function createLibraryStore(dir, { trash = (p) => fs.rm(p, { force: true }), now = () => new Date(), log = () => {} } = {}) {
  let state = null
  let loading = null
  let queue = Promise.resolve()
  const inside = (name) => path.join(dir, name)

  /** Изменения выполняются строго по очереди — library.json не перезапишет сам себя. */
  function serial(fn) {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  async function writeAtomic(file, data) {
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, data)
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.rename(tmp, file)
        return
      } catch (e) {
        if (attempt >= RENAME_ATTEMPTS || !BUSY_CODES.has(e?.code)) {
          await fs.rm(tmp, { force: true }).catch(() => {})
          throw e
        }
        await sleep(50 * attempt)
      }
    }
  }

  async function readIndex() {
    await fs.mkdir(dir, { recursive: true })
    const file = inside(INDEX)
    let text
    try {
      text = await fs.readFile(file, 'utf8')
    } catch (e) {
      if (e?.code === 'ENOENT') return { version: 1, nextId: 1, records: [] }
      // Файл есть, но не читается (занят, нет доступа) — это не «повреждён»: список трогать нельзя.
      throw new Error(`Не удалось прочитать library.json (${e?.code ?? e}). Файл занят или недоступен — закройте программы, которые его держат, и повторите`)
    }
    let parsed
    try {
      parsed = JSON.parse(text)
      if (!parsed || !Array.isArray(parsed.records) || typeof parsed.nextId !== 'number') throw new Error('неизвестный формат')
    } catch {
      const aside = `library.broken-${now().toISOString().replace(/[:.]/g, '-')}.json`
      await fs.rename(file, inside(aside)) // не удалось отложить — не продолжаем, чтобы не затереть файл
      log(`library.json повреждён и сохранён как ${aside}; библиотека начата заново, файлы прошивок на месте`)
      return { version: 1, nextId: 1, records: [] }
    }
    const records = parsed.records.filter(isValidRecord)
    const skipped = parsed.records.length - records.length
    if (skipped) log(`В library.json пропущено записей с неверными данными: ${skipped}`)
    const maxId = records.reduce((m, r) => Math.max(m, r.id), 0)
    return { version: 1, nextId: Math.max(parsed.nextId, maxId + 1), records }
  }

  /** Все обращения ждут одну и ту же загрузку; после ошибки можно попробовать снова. */
  function load() {
    if (state) return Promise.resolve(state)
    loading ??= readIndex().then(
      (s) => {
        state = s
        loading = null
        return s
      },
      (e) => {
        loading = null
        throw e
      },
    )
    return loading
  }

  /** Список меняется в памяти только после того, как он записан на диск. */
  async function commit(next) {
    await writeAtomic(inside(INDEX), JSON.stringify(next, null, 2))
    state = next
  }

  /** Имя не должно совпасть ни с файлом на диске, ни с файлом другой записи (даже пропавшим). */
  async function uniqueName(base, ext, keep, extraTaken = []) {
    const taken = new Set(extraTaken.map(lower))
    for (const r of state.records) {
      for (const f of [r.file, r.eepromFile]) if (f) taken.add(lower(f))
    }
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? `${base}${ext}` : `${base} (${n})${ext}`
      if (keep && lower(candidate) === lower(keep)) return candidate
      if (!taken.has(lower(candidate)) && !(await exists(inside(candidate)))) return candidate
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
        const eepromFile = eeprom instanceof Uint8Array ? await uniqueName(`${base}_eeprom`, '.bin', undefined, [file]) : undefined
        const written = []
        try {
          await writeAtomic(inside(file), data)
          written.push(file)
          if (eepromFile) {
            await writeAtomic(inside(eepromFile), eeprom)
            written.push(eepromFile)
          }
          const record = { note: '' }
          for (const k of META_FIELDS) if (meta[k] !== undefined) record[k] = meta[k]
          Object.assign(record, {
            id: state.nextId,
            size: data.length,
            createdAt: now().getTime(),
            hasEeprom: eepromFile !== undefined,
            file,
            ...(eepromFile ? { eepromFile } : {}),
          })
          await commit({ ...state, nextId: state.nextId + 1, records: [...state.records, record] })
          return record
        } catch (e) {
          for (const f of written) await fs.rm(inside(f), { force: true }).catch(() => {})
          throw e
        }
      })
    },

    async read(id) {
      await load()
      const rec = state.records.find((r) => r.id === id)
      if (!rec) return null
      try {
        const data = new Uint8Array(await fs.readFile(inside(rec.file)))
        const eeprom = rec.eepromFile
          ? new Uint8Array(await fs.readFile(inside(rec.eepromFile)).catch(() => Buffer.alloc(0)))
          : undefined
        return eeprom && eeprom.length ? { data, eeprom } : { data }
      } catch (e) {
        if (e?.code === 'ENOENT') return null
        throw e
      }
    },

    update(id, patch) {
      return serial(async () => {
        await load()
        const rec = { ...find(id) }
        if (typeof patch.note === 'string') rec.note = patch.note
        const renames = [] // [было, стало] — чтобы вернуть как было, если список не записался
        if (typeof patch.name === 'string' && patch.name.trim() && patch.name.trim() !== rec.name) {
          rec.name = patch.name.trim()
          const base = safeFileName(rec.name)
          const plan = async (from, suffix, extraTaken) => {
            const to = await uniqueName(`${base}${suffix}`, '.bin', from, extraTaken)
            if (to !== from) renames.push([from, to])
            return to
          }
          rec.file = await plan(rec.file, '', [])
          if (rec.eepromFile) rec.eepromFile = await plan(rec.eepromFile, '_eeprom', [rec.file])
        }
        const done = []
        try {
          for (const [from, to] of renames) {
            await fs.rename(inside(from), inside(to)).then(
              () => done.push([from, to]),
              (e) => {
                if (e?.code !== 'ENOENT') throw e // файла уже нет на диске — меняем только запись
              },
            )
          }
          await commit({ ...state, records: state.records.map((r) => (r.id === id ? rec : r)) })
          return { ...rec }
        } catch (e) {
          for (const [from, to] of done.reverse()) await fs.rename(inside(to), inside(from)).catch(() => {})
          throw e
        }
      })
    },

    /** permanent — удалить без Корзины (флешка, сетевая папка: там Корзины нет). */
    remove(id, permanent = false) {
      return serial(async () => {
        await load()
        const rec = find(id)
        // Файл может быть общим только из-за старой библиотеки — чужой файл не трогаем.
        const sharedWith = (f) => state.records.some((r) => r.id !== id && (lower(r.file) === lower(f) || (r.eepromFile && lower(r.eepromFile) === lower(f))))
        for (const f of [rec.file, rec.eepromFile]) {
          if (!f || sharedWith(f) || !(await exists(inside(f)))) continue
          if (permanent) {
            await fs.rm(inside(f), { force: true })
          } else {
            await Promise.resolve(trash(inside(f))).catch((e) => {
              throw new Error(`Корзина недоступна для этого файла (флешка, сетевая папка или файл занят): ${e?.message ?? e}`)
            })
          }
        }
        await commit({ ...state, records: state.records.filter((r) => r.id !== id) })
      })
    },

    async folderInfo() {
      await load()
      let bytes = 0
      for (const r of state.records) {
        for (const f of [r.file, r.eepromFile]) {
          if (f) bytes += await fs.stat(inside(f)).then((s) => s.size, () => 0)
        }
      }
      return { path: dir, count: state.records.length, bytes }
    },

    async filePath(id) {
      await load()
      const rec = state.records.find((r) => r.id === id)
      if (!rec) return null
      const p = inside(rec.file)
      return (await exists(p)) ? p : null
    },
  }
}
