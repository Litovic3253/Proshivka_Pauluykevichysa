import type { AppDesc } from '@/analysis/appDesc'
import type { Partition } from '@/analysis/partitions'

export type Family = 'avr' | 'esp32'
export type AvrBootloader = 'optiboot' | 'atmegaboot' | 'unknown'

export interface BoardInfo {
  family: Family
  chip: string // 'ATmega328P', 'ESP32-S3'
  revision?: string // полное описание от esptool, например «ESP32-D0WD-V3 (revision v3.1)»
  flashSize: number // байт
  mac?: string
  bootloader?: AvrBootloader
  baud: number
}

export type ReadTarget =
  | { kind: 'full' }
  | { kind: 'app' } // только ESP32
  | { kind: 'partition'; label: string } // только ESP32

export interface ReadResult {
  data: Uint8Array
  baseAddress: number // адрес начала data во flash
  eeprom?: Uint8Array // только AVR, если загрузчик позволил
  notes: string[]
  partitionLabel?: string
}

export type Progress = (done: number, total: number) => void

export interface AppInfo {
  partition: Partition
  desc: AppDesc | null
}

export interface BoardDriver {
  readonly info: BoardInfo
  read(target: ReadTarget, onProgress: Progress, signal: AbortSignal): Promise<ReadResult>
  write(data: Uint8Array, address: number, onProgress: Progress, signal: AbortSignal): Promise<void>
  readPartitionTable?(): Promise<Partition[]>
  activeAppPartition?(): Promise<Partition | null>
  appInfo?(): Promise<AppInfo | null>
  disconnect(): Promise<void>
}
