import { cString, u32le } from './bytes'

/** esp_app_desc_t — «паспорт», который ESP-IDF и Arduino-core зашивают в начало приложения. */
export const APP_DESC_MAGIC = 0xabcd5432
const APP_DESC_OFFSET = 0x20 // заголовок образа 24 байта + заголовок первого сегмента 8 байт
const APP_DESC_SIZE = 256

export interface AppDesc {
  version: string
  projectName: string
  time: string
  date: string
  idfVersion: string
  secureVersion: number
}

export function parseAppDesc(b: Uint8Array, imageOffset = 0): AppDesc | null {
  const o = imageOffset + APP_DESC_OFFSET
  if (o < 0 || b.length < o + APP_DESC_SIZE || u32le(b, o) !== APP_DESC_MAGIC) return null
  return {
    secureVersion: u32le(b, o + 4),
    version: cString(b, o + 16, 32),
    projectName: cString(b, o + 48, 32),
    time: cString(b, o + 80, 16),
    date: cString(b, o + 96, 16),
    idfVersion: cString(b, o + 112, 32),
  }
}
