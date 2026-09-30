import { parseAppDesc } from '@/analysis/appDesc'
import { parseEspImage } from '@/analysis/espImage'
import { parseIntelHex } from '@/analysis/intelHex'
import { PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE, parsePartitionTable } from '@/analysis/partitions'
import type { Family } from '@/drivers/types'
import type { DumpKind } from './db'

export interface IdentifiedFile {
  name: string
  family: Family | null
  chip: string | null
  kind: DumpKind
  baseAddress: number
  data: Uint8Array
  appName?: string
  appVersion?: string
}

/** Варианты для ручного выбора, когда по содержимому файла чип не определить. */
export const MANUAL_CHIPS: { chip: string; family: Family }[] = [
  { chip: 'ATmega328P', family: 'avr' },
  { chip: 'ESP32', family: 'esp32' },
  { chip: 'ESP32-S2', family: 'esp32' },
  { chip: 'ESP32-S3', family: 'esp32' },
  { chip: 'ESP32-C3', family: 'esp32' },
]

const DEFAULT_APP_OFFSET = 0x10000

function hasPartitionTable(bytes: Uint8Array): boolean {
  const end = PARTITION_TABLE_OFFSET + PARTITION_TABLE_SIZE
  return bytes.length >= end && parsePartitionTable(bytes.subarray(PARTITION_TABLE_OFFSET, end)).length > 0
}

export function identifyFile(fileName: string, bytes: Uint8Array): IdentifiedFile {
  const name = fileName.replace(/\.[^.]+$/, '')
  if (/\.hex$/i.test(fileName)) {
    const img = parseIntelHex(new TextDecoder().decode(bytes))
    return { name, family: 'avr', chip: 'ATmega328P', kind: 'full', baseAddress: img.baseAddress, data: img.data }
  }
  // Полный дамп ESP32/ESP32-S2: загрузчик на 0x1000 и таблица разделов на 0x8000.
  const bootAt1000 = parseEspImage(bytes, 0x1000)
  if (bootAt1000?.chipName && hasPartitionTable(bytes)) {
    return { name, family: 'esp32', chip: bootAt1000.chipName, kind: 'full', baseAddress: 0, data: bytes }
  }
  const atZero = parseEspImage(bytes, 0)
  if (atZero?.chipName) {
    const desc = parseAppDesc(bytes, 0)
    if (desc) {
      return {
        name,
        family: 'esp32',
        chip: atZero.chipName,
        kind: 'app',
        baseAddress: DEFAULT_APP_OFFSET,
        data: bytes,
        appName: desc.projectName,
        appVersion: desc.version,
      }
    }
    // Полный дамп S3/C3: загрузчик на 0x0.
    if (hasPartitionTable(bytes)) return { name, family: 'esp32', chip: atZero.chipName, kind: 'full', baseAddress: 0, data: bytes }
  }
  return { name, family: null, chip: null, kind: 'full', baseAddress: 0, data: bytes }
}
