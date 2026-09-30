import type { ByteTransport } from '@/serial/transport'
import { SerialTimeoutError } from '@/serial/transport'

interface EmulatorOptions {
  bootloader: 'optiboot' | 'atmegaboot'
  signature?: number[]
  corruptWrites?: boolean
}

/**
 * Программная Arduino с загрузчиком: отвечает по STK500v1 только на «своей» скорости
 * (Optiboot 115200, ATmegaBOOT 57600) и только после сброса по DTR. После LEAVE_PROGMODE
 * уходит в программу пользователя и молчит до следующего сброса — как настоящий Optiboot.
 */
export class Stk500Emulator implements ByteTransport {
  flash = new Uint8Array(0x8000).fill(0xff)
  eeprom = new Uint8Array(0x400).fill(0xff)
  opened: number | null = null
  pageWrites = 0
  private dtr = true
  private inBootloader = false
  private input: number[] = []
  private output: number[] = []
  private wordAddress = 0
  private readonly baud: number

  constructor(private readonly opts: EmulatorOptions) {
    this.baud = opts.bootloader === 'optiboot' ? 115200 : 57600
  }

  async open(baud: number) {
    this.opened = baud
    this.inBootloader = false
  }

  async close() {
    this.opened = null
    this.inBootloader = false
  }

  async setSignals(s: { dtr?: boolean; rts?: boolean }) {
    if (s.dtr === undefined) return
    if (s.dtr && !this.dtr) this.inBootloader = true // фронт DTR через конденсатор дёргает RESET
    this.dtr = s.dtr
  }

  async drain() {
    this.output = []
  }

  async write(data: Uint8Array) {
    if (this.opened !== this.baud || !this.inBootloader) return // на чужой скорости плата слышит мусор
    this.input.push(...data)
    this.process()
  }

  async read(n: number) {
    if (this.output.length < n) {
      const got = this.output.length
      this.output = []
      throw new SerialTimeoutError(n, got)
    }
    return Uint8Array.from(this.output.splice(0, n))
  }

  private commandLength(): number | null {
    const c = this.input[0]
    switch (c) {
      case 0x30: case 0x75: case 0x50: case 0x51: return 2
      case 0x41: return 3
      case 0x55: return 4
      case 0x74: return 5
      case 0x64: return this.input.length < 3 ? null : 5 + ((this.input[1] << 8) | this.input[2])
      default: return 1
    }
  }

  private process() {
    while (this.input.length) {
      const need = this.commandLength()
      if (need === null || this.input.length < need) return
      this.respond(this.input.splice(0, need))
    }
  }

  private param(p: number): number {
    if (this.opts.bootloader === 'optiboot') return p === 0x81 ? 8 : p === 0x82 ? 0 : 3
    return p === 0x80 ? 2 : p === 0x81 ? 1 : p === 0x82 ? 0x10 : 0
  }

  private respond(c: number[]) {
    if (c.length === 1) return // неизвестный байт — загрузчик его проглатывает
    if (c[c.length - 1] !== 0x20) {
      this.output.push(0x15) // STK_NOSYNC
      return
    }
    const ok = (...body: number[]) => this.output.push(0x14, ...body, 0x10)
    const byteAddress = this.wordAddress * 2
    switch (c[0]) {
      case 0x30: ok(); break
      case 0x75: ok(...(this.opts.signature ?? [0x1e, 0x95, 0x0f])); break
      case 0x41: ok(this.param(c[1])); break
      case 0x50: ok(); break
      case 0x51: ok(); this.inBootloader = false; break
      case 0x55: this.wordAddress = c[1] | (c[2] << 8); ok(); break
      case 0x74: {
        const len = (c[1] << 8) | c[2]
        const eeprom = c[3] === 0x45 && this.opts.bootloader === 'atmegaboot' // Optiboot вместо EEPROM отдаёт flash
        ok(...(eeprom ? this.eeprom : this.flash).subarray(byteAddress, byteAddress + len))
        break
      }
      case 0x64: {
        const len = (c[1] << 8) | c[2]
        const data = c.slice(4, 4 + len)
        if (this.opts.corruptWrites) data[0] ^= 0xff
        this.flash.set(data, byteAddress)
        this.pageWrites++
        ok()
        break
      }
    }
  }
}
