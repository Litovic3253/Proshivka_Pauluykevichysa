import { hexBytes } from '@/analysis/bytes'
import { type ByteTransport, sleep } from '@/serial/transport'

/** Протокол загрузчиков Arduino (Optiboot, ATmegaBOOT) — подмножество STK500 v1. */
export const STK = {
  OK: 0x10,
  INSYNC: 0x14,
  CRC_EOP: 0x20,
  GET_SYNC: 0x30,
  GET_PARAMETER: 0x41,
  ENTER_PROGMODE: 0x50,
  LEAVE_PROGMODE: 0x51,
  LOAD_ADDRESS: 0x55,
  PROG_PAGE: 0x64,
  READ_PAGE: 0x74,
  READ_SIGN: 0x75,
} as const

export class Stk500Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Stk500Error'
  }
}

export class Stk500 {
  constructor(
    private readonly t: ByteTransport,
    private readonly timeoutMs = 500,
  ) {}

  private async command(bytes: ArrayLike<number>, responseLength = 0): Promise<Uint8Array> {
    const packet = new Uint8Array(bytes.length + 1)
    packet.set(Array.from(bytes))
    packet[bytes.length] = STK.CRC_EOP
    await this.t.write(packet)
    const head = await this.t.read(1, this.timeoutMs)
    if (head[0] !== STK.INSYNC) throw new Stk500Error(`Загрузчик ответил не по протоколу (${hexBytes(head)})`)
    const body = responseLength ? await this.t.read(responseLength, this.timeoutMs) : new Uint8Array(0)
    const tail = await this.t.read(1, this.timeoutMs)
    if (tail[0] !== STK.OK) throw new Stk500Error(`Загрузчик не подтвердил команду (${hexBytes(tail)})`)
    return body
  }

  async sync(attempts = 5): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      await this.t.drain(20)
      try {
        await this.command([STK.GET_SYNC])
        return
      } catch {
        await sleep(50)
      }
    }
    throw new Stk500Error('Загрузчик Arduino не отвечает')
  }

  async signature(): Promise<number[]> {
    return Array.from(await this.command([STK.READ_SIGN], 3))
  }

  async getParameter(p: number): Promise<number> {
    return (await this.command([STK.GET_PARAMETER, p], 1))[0]
  }

  async enterProgMode(): Promise<void> {
    await this.command([STK.ENTER_PROGMODE])
  }

  async leaveProgMode(): Promise<void> {
    await this.command([STK.LEAVE_PROGMODE])
  }

  /** Загрузчики Arduino принимают адрес в словах (2 байта) и для flash, и для EEPROM. */
  private async loadAddress(byteAddr: number): Promise<void> {
    const word = byteAddr >> 1
    await this.command([STK.LOAD_ADDRESS, word & 0xff, (word >> 8) & 0xff])
  }

  async readPage(byteAddr: number, length: number, mem: 'F' | 'E'): Promise<Uint8Array> {
    await this.loadAddress(byteAddr)
    return this.command([STK.READ_PAGE, length >> 8, length & 0xff, mem.charCodeAt(0)], length)
  }

  async writePage(byteAddr: number, data: Uint8Array, mem: 'F' | 'E' = 'F'): Promise<void> {
    await this.loadAddress(byteAddr)
    const packet = new Uint8Array(4 + data.length)
    packet.set([STK.PROG_PAGE, data.length >> 8, data.length & 0xff, mem.charCodeAt(0)])
    packet.set(data, 4)
    await this.command(packet)
  }
}
