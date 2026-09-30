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
