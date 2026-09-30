import Dexie, { type EntityTable } from 'dexie'
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
}

/** Байты лежат отдельно, чтобы список библиотеки не тянул мегабайты. */
export interface FirmwareBlob {
  id: number
  data: Uint8Array
  eeprom?: Uint8Array
}

export const db = new Dexie('pauluk-firmware') as Dexie & {
  records: EntityTable<FirmwareRecord, 'id'>
  blobs: EntityTable<FirmwareBlob, 'id'>
}

db.version(1).stores({
  records: '++id, createdAt',
  blobs: 'id',
})
