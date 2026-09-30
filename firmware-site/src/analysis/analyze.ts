import type { Family } from '@/drivers/types'
import type { DumpKind } from '@/library/types'
import { type AppDesc, parseAppDesc } from './appDesc'
import { bootloaderOffset, ESP_IMAGE_MAGIC, type EspImage, looksEncrypted, parseEspImage } from './espImage'
import { selectAppPartition } from './otadata'
import { isOtaDataPartition, type Partition, PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE, parsePartitionTable } from './partitions'
import { type Usage, usage } from './usage'

export interface FirmwareAnalysis {
  usage: Usage
  bootloader: EspImage | null
  image: EspImage | null
  appDesc: AppDesc | null
  appOffset: number | null // адрес приложения во flash
  partitions: Partition[]
  encrypted: boolean | null
}

export interface AnalysisMeta {
  family: Family
  chip: string
  kind: DumpKind
  baseAddress: number
}

/** Всё, что можно узнать о прошивке без платы, — по байтам и адресу, с которого они считаны. */
export function analyzeFirmware(meta: AnalysisMeta, data: Uint8Array): FirmwareAnalysis {
  const result: FirmwareAnalysis = {
    usage: usage(data, meta.family === 'avr' ? 128 : 4096),
    bootloader: null,
    image: null,
    appDesc: null,
    appOffset: null,
    partitions: [],
    encrypted: null,
  }
  if (meta.family !== 'esp32') return result

  const at = (flashAddress: number) => flashAddress - meta.baseAddress
  const covers = (flashAddress: number, length: number) => at(flashAddress) >= 0 && at(flashAddress) + length <= data.length

  if (covers(PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE)) {
    const start = at(PARTITION_TABLE_OFFSET)
    result.partitions = parsePartitionTable(data.subarray(start, start + PARTITION_TABLE_SIZE))
  }
  result.encrypted = looksEncrypted(data, meta.baseAddress, meta.chip)
  if (covers(bootloaderOffset(meta.chip), 24)) result.bootloader = parseEspImage(data, at(bootloaderOffset(meta.chip)))

  let appAt: number | null = null
  if (result.partitions.length) {
    const ota = result.partitions.find(isOtaDataPartition)
    const otadata = ota && covers(ota.offset, 0x2000) ? data.subarray(at(ota.offset), at(ota.offset) + 0x2000) : null
    const app = selectAppPartition(result.partitions, otadata)
    if (app && covers(app.offset, 1)) appAt = at(app.offset)
  } else if (meta.kind === 'app' || (meta.kind === 'partition' && data[0] === ESP_IMAGE_MAGIC)) {
    appAt = 0
  }
  if (appAt !== null) {
    result.image = parseEspImage(data, appAt)
    result.appDesc = parseAppDesc(data, appAt)
    result.appOffset = meta.baseAddress + appAt
  }
  return result
}
