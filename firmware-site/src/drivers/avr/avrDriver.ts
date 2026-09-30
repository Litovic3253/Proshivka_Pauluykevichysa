import { hexAddr, hexBytes, sameBytes } from '@/analysis/bytes'
import { type ByteTransport, sleep } from '@/serial/transport'
import { UnsupportedChipError, VerifyError } from '../errors'
import type { AvrBootloader, BoardDriver, BoardInfo, Progress, ReadResult, ReadTarget } from '../types'
import { Stk500 } from './stk500'

export const ATMEGA328P = {
  name: 'ATmega328P',
  signature: [0x1e, 0x95, 0x0f],
  flashSize: 0x8000,
  eepromSize: 0x400,
  pageSize: 128,
} as const

/** Конец области приложения: Optiboot занимает 512 байт, старый ATmegaBOOT — 2 КБ. */
export function appAreaEnd(kind: AvrBootloader): number {
  return kind === 'optiboot' ? 0x7e00 : 0x7800
}

/** Импульс на DTR/RTS через конденсатор на плате дёргает RESET — плата уходит в загрузчик. */
async function resetBoard(t: ByteTransport): Promise<void> {
  await t.setSignals({ dtr: false, rts: false })
  await sleep(250)
  await t.setSignals({ dtr: true, rts: true })
  await sleep(50)
  await t.drain(20)
}

async function enterBootloader(t: ByteTransport, stk: Stk500): Promise<void> {
  await resetBoard(t)
  await stk.sync()
  await stk.enterProgMode()
}

export async function connectAvr(t: ByteTransport, baud: number): Promise<AvrDriver> {
  await t.open(baud)
  try {
    const stk = new Stk500(t)
    await enterBootloader(t, stk)
    const sig = await stk.signature()
    if (!sameBytes(sig, ATMEGA328P.signature)) throw new UnsupportedChipError(`сигнатура ${hexBytes(sig)}`)
    const major = await stk.getParameter(0x81).catch(() => null)
    const bootloader: AvrBootloader = major === null ? 'unknown' : major >= 4 ? 'optiboot' : 'atmegaboot'
    await stk.leaveProgMode().catch(() => {}) // плата продолжает работать, пока её не попросят
    return new AvrDriver(t, stk, {
      family: 'avr',
      chip: ATMEGA328P.name,
      flashSize: ATMEGA328P.flashSize,
      bootloader,
      baud,
    })
  } catch (e) {
    await t.close().catch(() => {})
    throw e
  }
}

export class AvrDriver implements BoardDriver {
  constructor(
    private readonly t: ByteTransport,
    private readonly stk: Stk500,
    readonly info: BoardInfo,
  ) {}

  /** Optiboot сам выходит из загрузчика через ~1 с простоя, поэтому каждая операция начинается со сброса. */
  private async session<T>(fn: () => Promise<T>): Promise<T> {
    await enterBootloader(this.t, this.stk)
    try {
      return await fn()
    } finally {
      await this.stk.leaveProgMode().catch(() => {})
    }
  }

  async read(target: ReadTarget, onProgress: Progress, signal: AbortSignal): Promise<ReadResult> {
    if (target.kind !== 'full') throw new Error('Для Arduino доступно только чтение всей flash')
    signal.throwIfAborted()
    return this.session(async () => {
      const { flashSize, pageSize, eepromSize } = ATMEGA328P
      const data = new Uint8Array(flashSize)
      for (let addr = 0; addr < flashSize; addr += pageSize) {
        signal.throwIfAborted()
        data.set(await this.stk.readPage(addr, pageSize, 'F'), addr)
        onProgress(addr + pageSize, flashSize)
      }
      const notes: string[] = []
      let eeprom: Uint8Array | undefined
      if (this.info.bootloader === 'atmegaboot') {
        eeprom = new Uint8Array(eepromSize)
        for (let addr = 0; addr < eepromSize; addr += pageSize) {
          signal.throwIfAborted()
          eeprom.set(await this.stk.readPage(addr, pageSize, 'E'), addr)
        }
      } else {
        notes.push('EEPROM не сохранена: загрузчик Optiboot её не читает')
      }
      return { data, baseAddress: 0, eeprom, notes }
    })
  }

  async write(data: Uint8Array, address: number, onProgress: Progress, signal: AbortSignal): Promise<void> {
    if (address !== 0) throw new Error('Прошивка Arduino должна начинаться с адреса 0')
    signal.throwIfAborted()
    const end = appAreaEnd(this.info.bootloader ?? 'unknown')
    const { pageSize } = ATMEGA328P
    // Скетч с платы на Optiboot может занимать до 0x7E00 — на плате со старым загрузчиком он не влезет.
    if (data.subarray(end, appAreaEnd('optiboot')).some((b) => b !== 0xff)) {
      throw new Error(
        `Прошивка не помещается: загрузчик этой платы начинается с ${hexAddr(end)}, а в файле есть код дальше. Нужна плата с загрузчиком Optiboot`,
      )
    }
    // Пишем всю область приложения, включая пустые страницы: иначе на плате останутся
    // хвосты старой прошивки. Загрузчик сам себя не перезаписывает — его область пропускаем.
    const image = new Uint8Array(end).fill(0xff)
    image.set(data.subarray(0, Math.min(data.length, end)))
    const total = end * 2 // запись + проверка
    await this.session(async () => {
      for (let addr = 0; addr < end; addr += pageSize) {
        signal.throwIfAborted()
        await this.stk.writePage(addr, image.subarray(addr, addr + pageSize))
        onProgress(addr + pageSize, total)
      }
      for (let addr = 0; addr < end; addr += pageSize) {
        signal.throwIfAborted()
        const back = await this.stk.readPage(addr, pageSize, 'F')
        if (!sameBytes(back, image.subarray(addr, addr + pageSize))) throw new VerifyError(addr)
        onProgress(end + addr + pageSize, total)
      }
    })
  }

  async disconnect(): Promise<void> {
    await this.t.close()
  }
}
