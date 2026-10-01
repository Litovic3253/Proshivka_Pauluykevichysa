import { sha256Hex } from '@/analysis/hash'
import { bridge } from '@/bridge'
import type { Family } from '@/drivers/types'
import type { DumpKind, FirmwareBlob, FirmwareRecord } from './types'

export type { DumpKind, FirmwareBlob, FirmwareRecord }

export const MISSING_FILE = 'Файл прошивки не найден в папке — его удалили или переименовали вручную'
export const CHANGED_FILE = 'Файл прошивки изменён вне программы: размер или контрольная сумма не совпадают с записью. Анализировать и заливать его нельзя'
export const NO_TRASH = 'Корзина недоступна'

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

/** Байты прошивки. Файл лежит в обычной папке, поэтому сверяем его с записью, прежде чем отдать. */
export async function getFirmwareData(id: number): Promise<FirmwareBlob | undefined> {
  const [blob, rec] = await Promise.all([bridge().library.read(id), getFirmware(id)])
  if (!blob || !rec) return undefined
  if (blob.data.length !== rec.size || (await sha256Hex(blob.data)) !== rec.sha256) throw new Error(CHANGED_FILE)
  return { id, ...blob }
}

export async function updateFirmware(id: number, patch: Partial<Pick<FirmwareRecord, 'name' | 'note'>>): Promise<void> {
  await bridge().library.update(id, patch)
  changed()
}

/** permanent — мимо Корзины: на флешке и в сетевой папке Корзины нет. */
export async function deleteFirmware(id: number, permanent = false): Promise<void> {
  await bridge().library.remove(id, permanent)
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
