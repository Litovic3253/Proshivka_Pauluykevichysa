import { cString, u32le } from './bytes'

export const PARTITION_TABLE_OFFSET = 0x8000
export const PARTITION_TABLE_SIZE = 0xc00
const ENTRY_SIZE = 32

export interface Partition {
  label: string
  type: number
  subtype: number
  typeName: string
  subtypeName: string
  offset: number
  size: number
  encrypted: boolean
}

const DATA_SUBTYPES: Record<number, string> = {
  0x00: 'ota',
  0x01: 'phy',
  0x02: 'nvs',
  0x03: 'coredump',
  0x04: 'nvs_keys',
  0x05: 'efuse',
  0x80: 'esphttpd',
  0x81: 'fat',
  0x82: 'spiffs',
  0x83: 'littlefs',
}

function subtypeName(type: number, subtype: number): string {
  if (type === 0) {
    if (subtype === 0x00) return 'factory'
    if (subtype >= 0x10 && subtype <= 0x1f) return `ota_${subtype - 0x10}`
    if (subtype === 0x20) return 'test'
  }
  if (type === 1 && DATA_SUBTYPES[subtype]) return DATA_SUBTYPES[subtype]
  return `0x${subtype.toString(16).padStart(2, '0')}`
}

/** b — байты, начиная с адреса таблицы. Записи идут до MD5-записи (0xEBEB) или пустоты (0xFFFF). */
export function parsePartitionTable(b: Uint8Array): Partition[] {
  const out: Partition[] = []
  for (let o = 0; o + ENTRY_SIZE <= b.length; o += ENTRY_SIZE) {
    if (b[o] !== 0xaa || b[o + 1] !== 0x50) break
    const type = b[o + 2]
    const subtype = b[o + 3]
    out.push({
      label: cString(b, o + 12, 16),
      type,
      subtype,
      typeName: type === 0 ? 'app' : type === 1 ? 'data' : `0x${type.toString(16)}`,
      subtypeName: subtypeName(type, subtype),
      offset: u32le(b, o + 4),
      size: u32le(b, o + 8),
      encrypted: (u32le(b, o + 28) & 1) === 1,
    })
  }
  return out
}

export function isAppPartition(p: Partition): boolean {
  return p.type === 0
}

export function isOtaDataPartition(p: Partition): boolean {
  return p.type === 1 && p.subtype === 0x00
}
