import type { FlashOptions } from 'esptool-js'
import type { EspLoaderLike } from '@/drivers/esp32/esp32Driver'

export interface FakeOptions {
  notEsp?: boolean
  failReadAtBaud?: number[]
}

/** ESP32 с 4 МБ flash: отвечает как esptool-js, но работает с массивом в памяти. */
export class FakeEspLoader implements EspLoaderLike {
  chip?: EspLoaderLike['chip']
  writes: { address: number; length: number; flashMode: string }[] = []
  disconnects = 0
  resets = 0

  constructor(
    public flash: Uint8Array,
    public baud: number,
    private readonly opts: FakeOptions = {},
  ) {}

  transport = {
    disconnect: async () => {
      this.disconnects++
    },
  }

  async main(): Promise<string> {
    if (this.opts.notEsp) throw new Error('Failed to connect with the device')
    this.chip = { CHIP_NAME: 'ESP32', readMac: async () => '7c:df:a1:00:11:22' }
    return 'ESP32-D0WD-V3 (revision v3.1)'
  }

  async detectFlashSize(): Promise<string> {
    return '4MB'
  }

  async readFlash(addr: number, size: number, cb?: ((p: Uint8Array, progress: number, total: number) => void) | null) {
    if (this.opts.failReadAtBaud?.includes(this.baud)) throw new Error('Timeout waiting for packet')
    const out = this.flash.slice(addr, addr + size)
    for (let done = 0x1000; done < size; done += 0x1000) cb?.(new Uint8Array(0), done, size)
    cb?.(new Uint8Array(0), size, size)
    return out
  }

  async writeFlash(o: FlashOptions): Promise<void> {
    for (const f of o.fileArray) {
      o.calculateMD5Hash?.(f.data)
      this.flash.set(f.data, f.address)
      this.writes.push({ address: f.address, length: f.data.length, flashMode: o.flashMode })
      o.reportProgress?.(0, f.data.length, f.data.length)
    }
  }

  async after(): Promise<void> {
    this.resets++
  }
}
