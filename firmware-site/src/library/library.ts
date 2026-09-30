import { sha256Hex } from '@/analysis/hash'
import type { Family } from '@/drivers/types'
import { db, type DumpKind, type FirmwareBlob, type FirmwareRecord } from './db'

export type { DumpKind, FirmwareBlob, FirmwareRecord }

export interface NewFirmware {
  name: string
  family: Family
  chip: string
  kind: DumpKind
  partitionLabel?: string
  baseAddress: number
  data: Uint8Array
  eeprom?: Uint8Array
  note?: string
  source: 'board' | 'file'
  appName?: string
  appVersion?: string
}

export async function saveFirmware(input: NewFirmware): Promise<FirmwareRecord> {
  const { data, eeprom, ...meta } = input
  const record: Omit<FirmwareRecord, 'id'> = {
    ...meta,
    note: meta.note ?? '',
    size: data.length,
    sha256: await sha256Hex(data),
    createdAt: Date.now(),
    hasEeprom: eeprom !== undefined,
  }
  const id = await db.transaction('rw', db.records, db.blobs, async () => {
    const newId = await db.records.add(record)
    await db.blobs.add({ id: newId, data, eeprom })
    return newId
  })
  return { ...record, id }
}

export function listFirmware(): Promise<FirmwareRecord[]> {
  return db.records.orderBy('createdAt').reverse().toArray()
}

export function getFirmware(id: number): Promise<FirmwareRecord | undefined> {
  return db.records.get(id)
}

export function getFirmwareData(id: number): Promise<FirmwareBlob | undefined> {
  return db.blobs.get(id)
}

export async function updateFirmware(id: number, patch: Partial<Pick<FirmwareRecord, 'name' | 'note'>>): Promise<void> {
  await db.records.update(id, patch)
}

export async function deleteFirmware(id: number): Promise<void> {
  await db.transaction('rw', db.records, db.blobs, async () => {
    await db.records.delete(id)
    await db.blobs.delete(id)
  })
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  const e = await navigator.storage.estimate()
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
}

export const KIND_LABELS: Record<DumpKind, string> = {
  full: 'Вся flash',
  app: 'Приложение',
  partition: 'Раздел',
}

export function kindLabel(r: Pick<FirmwareRecord, 'kind' | 'partitionLabel'>): string {
  return r.kind === 'partition' && r.partitionLabel ? `Раздел ${r.partitionLabel}` : KIND_LABELS[r.kind]
}
