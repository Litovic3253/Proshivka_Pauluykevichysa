import { sha256Hex } from '@/analysis/hash'
import { bridge } from '@/bridge'
import type { Family } from '@/drivers/types'
import type { DumpKind, FirmwareBlob, FirmwareRecord } from './types'

export type { DumpKind, FirmwareBlob, FirmwareRecord }

export const MISSING_FILE = 'Файл прошивки не найден в папке — его удалили или переименовали вручную'

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

const listeners = new Set<() => void>()
const changed = () => listeners.forEach((fn) => fn())

export function subscribeLibrary(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export async function saveFirmware(input: NewFirmware): Promise<FirmwareRecord> {
  const { data, eeprom, ...meta } = input
  const rec = await bridge().library.save({ ...meta, sha256: await sha256Hex(data) }, data, eeprom)
  changed()
  return rec
}

export function listFirmware(): Promise<FirmwareRecord[]> {
  return bridge().library.list()
}

export async function getFirmware(id: number): Promise<FirmwareRecord | undefined> {
  return (await listFirmware()).find((r) => r.id === id)
}

export async function getFirmwareData(id: number): Promise<FirmwareBlob | undefined> {
  const blob = await bridge().library.read(id)
  return blob ? { id, ...blob } : undefined
}

export async function updateFirmware(id: number, patch: Partial<Pick<FirmwareRecord, 'name' | 'note'>>): Promise<void> {
  await bridge().library.update(id, patch)
  changed()
}

export async function deleteFirmware(id: number): Promise<void> {
  await bridge().library.remove(id)
  changed()
}

export const libraryFolder = () => bridge().library.folder()
export const openLibraryFolder = () => bridge().library.openFolder()
export const showFirmwareInFolder = (id: number) => bridge().library.showInFolder(id)

export const KIND_LABELS: Record<DumpKind, string> = {
  full: 'Вся flash',
  app: 'Приложение',
  partition: 'Раздел',
}

export function kindLabel(r: Pick<FirmwareRecord, 'kind' | 'partitionLabel'>): string {
  return r.kind === 'partition' && r.partitionLabel ? `Раздел ${r.partitionLabel}` : KIND_LABELS[r.kind]
}
