import type { FirmwareRecord } from '@/library/types'

/** Порт из списка Electron. vendorId/productId — десятичные строки (так их отдаёт Electron). */
export interface PortChoice {
  portId: string
  portName: string
  displayName?: string
  vendorId?: string
  productId?: string
}

export type NewFirmwareMeta = Omit<FirmwareRecord, 'id' | 'size' | 'createdAt' | 'hasEeprom' | 'file' | 'eepromFile' | 'note'> & { note?: string }

export interface PaulukBridge {
  library: {
    list(): Promise<FirmwareRecord[]>
    save(meta: NewFirmwareMeta, data: Uint8Array, eeprom?: Uint8Array): Promise<FirmwareRecord>
    read(id: number): Promise<{ data: Uint8Array; eeprom?: Uint8Array } | null>
    update(id: number, patch: { name?: string; note?: string }): Promise<FirmwareRecord>
    remove(id: number, permanent?: boolean): Promise<void>
    folder(): Promise<{ path: string; bytes: number; count: number }>
    openFolder(): Promise<void>
    showInFolder(id: number): Promise<void>
  }
  files: {
    saveAs(defaultName: string, data: Uint8Array | string): Promise<'saved' | 'cancelled'>
  }
  ports: {
    onRequest(cb: (ports: PortChoice[]) => void): () => void
    choose(portId: string | null): void
  }
  app: {
    ready(): void
  }
}

declare global {
  interface Window {
    pauluk?: PaulukBridge
  }
}

export function bridge(): PaulukBridge {
  const b = (globalThis as { pauluk?: PaulukBridge }).pauluk
  if (!b) throw new Error('Мост программы недоступен: запустите «Прошивки Паулюкевичуса», а не страницу в браузере')
  return b
}
