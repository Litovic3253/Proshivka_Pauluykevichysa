import { ESPLoader, Transport, type FlashOptions } from 'esptool-js'
import SparkMD5 from 'spark-md5'
import { hexAddr, toArrayBuffer, u32le } from '@/analysis/bytes'
import { parseAppDesc } from '@/analysis/appDesc'
import { ESP_IMAGE_MAGIC, espImageLengthFromHeaders, looksEncrypted } from '@/analysis/espImage'
import { selectAppPartition } from '@/analysis/otadata'
import {
  isOtaDataPartition,
  PARTITION_TABLE_OFFSET,
  PARTITION_TABLE_SIZE,
  parsePartitionTable,
  type Partition,
} from '@/analysis/partitions'
import type { AppInfo, BoardDriver, BoardInfo, Progress, ReadResult, ReadTarget } from '../types'

/** То, чем мы пользуемся из ESPLoader, — чтобы в тестах подставить поддельный загрузчик. */
export interface EspLoaderLike {
  chip?: { CHIP_NAME: string; readMac(loader: never): Promise<string> }
  main(mode?: 'default_reset'): Promise<string>
  detectFlashSize(): Promise<string | undefined>
  readFlash(
    addr: number,
    size: number,
    onPacket?: ((packet: Uint8Array, progress: number, total: number) => void) | null,
  ): Promise<Uint8Array>
  writeFlash(options: FlashOptions): Promise<void>
  after(mode?: 'hard_reset'): Promise<void>
  transport: { disconnect(): Promise<void> }
}

export type LoaderFactory = (port: SerialPort, baud: number, log: (line: string) => void) => EspLoaderLike

export const defaultLoaderFactory: LoaderFactory = (port, baud, log) => {
  const transport = new Transport(port, false)
  const terminal = { clean() {}, writeLine: (s: string) => log(s), write: (s: string) => log(s) }
  return new ESPLoader({ transport, baudrate: baud, romBaudrate: 115200, terminal }) as unknown as EspLoaderLike
}

export const BAUD_STEPS = [921600, 460800, 115200]
const READ_CHUNK = 0x10000
const WRITE_CHUNK = 0x40000

export function parseFlashSize(s: string | undefined): number {
  const m = /^(\d+)(KB|MB)/.exec(s ?? '')
  if (!m) throw new Error(`Не удалось определить размер flash (${s ?? 'нет ответа'})`)
  return Number(m[1]) * (m[2] === 'MB' ? 1024 * 1024 : 1024)
}

export async function connectEsp32(
  port: SerialPort,
  log: (line: string) => void,
  factory: LoaderFactory = defaultLoaderFactory,
): Promise<Esp32Driver> {
  let lastError: unknown
  for (const baud of BAUD_STEPS) {
    const loader = factory(port, baud, log)
    try {
      const description = await loader.main('default_reset')
      await loader.readFlash(0, 0x1000) // проверяем, что выбранная скорость держится
      const flashSize = parseFlashSize(await loader.detectFlashSize())
      const chip = loader.chip!
      const mac = await chip.readMac(loader as never)
      return new Esp32Driver(loader, { family: 'esp32', chip: chip.CHIP_NAME, revision: description, flashSize, mac, baud })
    } catch (e) {
      lastError = e
      await loader.transport.disconnect().catch(() => {})
      if (!loader.chip) break // это вообще не ESP32 — другие скорости не помогут
      log(`Скорость ${baud} не держится, пробую ниже`)
    }
  }
  throw lastError
}

export class Esp32Driver implements BoardDriver {
  private partitions: Partition[] | null = null

  constructor(
    private readonly loader: EspLoaderLike,
    readonly info: BoardInfo,
  ) {}

  private async readRange(addr: number, size: number, onProgress: Progress, signal: AbortSignal): Promise<Uint8Array> {
    const out = new Uint8Array(size)
    for (let off = 0; off < size; off += READ_CHUNK) {
      signal.throwIfAborted()
      const len = Math.min(READ_CHUNK, size - off)
      const part = await this.loader.readFlash(addr + off, len, (_p, progress) => onProgress(off + progress, size))
      out.set(part.subarray(0, len), off)
    }
    onProgress(size, size)
    return out
  }

  async readPartitionTable(): Promise<Partition[]> {
    if (!this.partitions) {
      const parts = parsePartitionTable(await this.loader.readFlash(PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE))
      if (!parts.length) throw new Error('Таблица разделов не найдена — flash пустая или зашифрована')
      this.partitions = parts
    }
    return this.partitions
  }

  async activeAppPartition(): Promise<Partition | null> {
    const parts = await this.readPartitionTable()
    const ota = parts.find(isOtaDataPartition)
    const otadata = ota ? await this.loader.readFlash(ota.offset, Math.min(ota.size, 0x2000)) : null
    return selectAppPartition(parts, otadata)
  }

  async appInfo(): Promise<AppInfo | null> {
    const partition = await this.activeAppPartition()
    if (!partition) return null
    const head = await this.loader.readFlash(partition.offset, 0x200)
    return { partition, desc: parseAppDesc(head, 0) }
  }

  /** Длина образа по заголовкам сегментов — чтобы не читать весь раздел ради 200 КБ приложения. */
  private async imageLength(addr: number, max: number): Promise<number | null> {
    const header = await this.loader.readFlash(addr, 24)
    const count = header[1]
    if (header[0] !== ESP_IMAGE_MAGIC || count === 0 || count > 16) return null
    const lengths: number[] = []
    let pos = 24
    for (let i = 0; i < count; i++) {
      const seg = await this.loader.readFlash(addr + pos, 8)
      const len = u32le(seg, 4)
      pos += 8 + len
      if (pos > max) return null
      lengths.push(len)
    }
    const total = espImageLengthFromHeaders(header, lengths)
    return total <= max ? total : null
  }

  async read(target: ReadTarget, onProgress: Progress, signal: AbortSignal): Promise<ReadResult> {
    signal.throwIfAborted()
    if (target.kind === 'full') {
      const data = await this.readRange(0, this.info.flashSize, onProgress, signal)
      const notes = looksEncrypted(data, 0, this.info.chip)
        ? ['Похоже, flash зашифрована: дамп сохранён, но на другой плате он работать не будет']
        : []
      return { data, baseAddress: 0, notes }
    }
    if (target.kind === 'partition') {
      const p = (await this.readPartitionTable()).find((x) => x.label === target.label)
      if (!p) throw new Error(`Раздел «${target.label}» не найден`)
      const data = await this.readRange(p.offset, p.size, onProgress, signal)
      return { data, baseAddress: p.offset, notes: [], partitionLabel: p.label }
    }
    const app = await this.activeAppPartition()
    if (!app) throw new Error('На плате нет раздела с приложением')
    const length = await this.imageLength(app.offset, app.size)
    const data = await this.readRange(app.offset, length ?? app.size, onProgress, signal)
    const notes = [`Раздел ${app.label} (${hexAddr(app.offset)})`]
    if (length === null) notes.push('Заголовок приложения не распознан — сохранён весь раздел')
    return { data, baseAddress: app.offset, notes, partitionLabel: app.label }
  }

  async write(data: Uint8Array, address: number, onProgress: Progress, signal: AbortSignal): Promise<void> {
    this.partitions = null // после записи таблица разделов могла измениться
    for (let off = 0; off < data.length; off += WRITE_CHUNK) {
      signal.throwIfAborted()
      const chunk = data.subarray(off, Math.min(off + WRITE_CHUNK, data.length))
      await this.loader.writeFlash({
        fileArray: [{ data: chunk, address: address + off }],
        flashMode: 'keep',
        flashFreq: 'keep',
        flashSize: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (_i, written, total) => onProgress(off + Math.round((chunk.length * written) / (total || 1)), data.length),
        calculateMD5Hash: (image) => SparkMD5.ArrayBuffer.hash(toArrayBuffer(image)),
      })
    }
    onProgress(data.length, data.length)
  }

  async disconnect(): Promise<void> {
    await this.loader.after('hard_reset').catch(() => {})
    await this.loader.transport.disconnect().catch(() => {})
  }
}
