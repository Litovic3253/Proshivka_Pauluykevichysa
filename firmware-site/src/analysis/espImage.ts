import { u16le, u32le } from './bytes'

/** Формат образа ESP-IDF: заголовок 24 байта, сегменты «адрес+длина+данные», контрольная сумма, SHA-256. */
export const ESP_IMAGE_MAGIC = 0xe9

export const ESP_CHIP_NAMES: Record<number, string> = {
  0: 'ESP32',
  2: 'ESP32-S2',
  5: 'ESP32-C3',
  9: 'ESP32-S3',
  12: 'ESP32-C2',
  13: 'ESP32-C6',
  16: 'ESP32-H2',
  18: 'ESP32-P4',
}

const MB = 1024 * 1024
const FLASH_SIZES_MB = [1, 2, 4, 8, 16, 32, 64, 128]
const HEADER_SIZE = 24
const SEGMENT_HEADER_SIZE = 8
const MAX_SEGMENTS = 16

export interface EspSegment {
  loadAddress: number
  length: number
  dataOffset: number
}

export interface EspImage {
  chipId: number
  chipName: string | null
  flashSizeBytes: number | null
  entry: number
  hashAppended: boolean
  segments: EspSegment[]
  length: number
}

/**
 * Длина образа по заголовку (24 байта) и длинам сегментов: после сегментов — выравнивание,
 * байт контрольной суммы в конце 16-байтного блока и, если hash_appended, 32 байта SHA-256.
 */
export function espImageLengthFromHeaders(header: Uint8Array, segmentLengths: number[]): number {
  let pos = HEADER_SIZE
  for (const len of segmentLengths) pos += SEGMENT_HEADER_SIZE + len
  pos += 16 - (pos % 16)
  if (header[23] === 1) pos += 32
  return pos
}

export function parseEspImage(b: Uint8Array, offset = 0): EspImage | null {
  if (b.length < offset + HEADER_SIZE || b[offset] !== ESP_IMAGE_MAGIC) return null
  const count = b[offset + 1]
  if (count === 0 || count > MAX_SEGMENTS) return null
  const segments: EspSegment[] = []
  let pos = offset + HEADER_SIZE
  for (let i = 0; i < count; i++) {
    if (pos + SEGMENT_HEADER_SIZE > b.length) return null
    const length = u32le(b, pos + 4)
    if (pos + SEGMENT_HEADER_SIZE + length > b.length) return null
    segments.push({ loadAddress: u32le(b, pos), length, dataOffset: pos + SEGMENT_HEADER_SIZE })
    pos += SEGMENT_HEADER_SIZE + length
  }
  const header = b.subarray(offset, offset + HEADER_SIZE)
  const length = espImageLengthFromHeaders(header, segments.map((s) => s.length))
  if (offset + length > b.length) return null
  const chipId = u16le(b, offset + 12)
  const sizeCode = b[offset + 3] >> 4
  return {
    chipId,
    chipName: ESP_CHIP_NAMES[chipId] ?? null,
    flashSizeBytes: sizeCode < FLASH_SIZES_MB.length ? FLASH_SIZES_MB[sizeCode] * MB : null,
    entry: u32le(b, offset + 4),
    hashAppended: b[offset + 23] === 1,
    segments,
    length,
  }
}

export function bootloaderOffset(chip: string): number {
  return chip === 'ESP32' || chip === 'ESP32-S2' ? 0x1000 : 0
}

/**
 * true — на месте загрузчика нет 0xE9 (похоже на шифрование flash); false — загрузчик
 * открытый или flash пустая; null — дамп не содержит адрес загрузчика.
 */
export function looksEncrypted(data: Uint8Array, baseAddress: number, chip: string): boolean | null {
  const off = bootloaderOffset(chip) - baseAddress
  if (off < 0 || off >= data.length) return null
  const b = data[off]
  return b !== ESP_IMAGE_MAGIC && b !== 0xff
}
