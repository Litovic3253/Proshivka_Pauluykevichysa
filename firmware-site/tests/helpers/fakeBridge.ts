import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLibraryStore } from '../../electron/libraryStore.mjs'
import type { PaulukBridge, PortChoice } from '@/bridge'

/** Настоящее хранилище во временной папке за фальшивым мостом — как в программе, только без Electron. */
export async function installFakeBridge() {
  const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'pauluk-ui-')), 'Прошивки')
  let clock = 1
  const store = createLibraryStore(dir, { now: () => new Date(clock++ * 1000), trash: (p: string) => rm(p) })
  const chosen: (string | null)[] = []
  const saved: { name: string; data: Uint8Array | string }[] = []
  const shown: number[] = []
  let portListener: ((p: PortChoice[]) => void) | null = null
  const b: PaulukBridge = {
    library: {
      list: () => store.list(),
      save: (meta, data, eeprom) => store.save(meta, data, eeprom),
      read: (id) => store.read(id),
      update: (id, patch) => store.update(id, patch),
      remove: (id, permanent) => store.remove(id, permanent),
      folder: () => store.folderInfo(),
      openFolder: async () => {},
      showInFolder: async (id) => { shown.push(id) },
    },
    files: { saveAs: async (name, data) => { saved.push({ name, data }); return 'saved' } },
    ports: {
      onRequest: (cb) => { portListener = cb; return () => { portListener = null } },
      choose: (id) => { chosen.push(id) },
    },
    app: { ready: () => {} },
  }
  ;(globalThis as { pauluk?: PaulukBridge }).pauluk = b
  return {
    dir,
    chosen,
    saved,
    shown,
    offerPorts: (p: PortChoice[]) => portListener?.(p),
    cleanup: async () => {
      delete (globalThis as { pauluk?: PaulukBridge }).pauluk
      await rm(path.dirname(dir), { recursive: true, force: true })
    },
  }
}
