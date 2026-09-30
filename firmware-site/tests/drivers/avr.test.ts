import { describe, expect, it } from 'vitest'
import { ATMEGA328P, appAreaEnd, connectAvr } from '@/drivers/avr/avrDriver'
import { UnsupportedChipError, VerifyError } from '@/drivers/errors'
import { Stk500Emulator } from '../helpers/stk500Emulator'

function randomFlash(emu: Stk500Emulator) {
  for (let i = 0; i < emu.flash.length; i++) emu.flash[i] = (i * 31 + 7) & 0xff
}
const noop = () => {}
const live = () => new AbortController().signal

describe('connectAvr', () => {
  it('подключается к Optiboot на 115200', async () => {
    const emu = new Stk500Emulator({ bootloader: 'optiboot' })
    const d = await connectAvr(emu, 115200)
    expect(d.info).toMatchObject({ family: 'avr', chip: 'ATmega328P', flashSize: 0x8000, bootloader: 'optiboot', baud: 115200 })
    await d.disconnect()
    expect(emu.opened).toBeNull()
  })

  it('узнаёт старый загрузчик Nano на 57600', async () => {
    const d = await connectAvr(new Stk500Emulator({ bootloader: 'atmegaboot' }), 57600)
    expect(d.info.bootloader).toBe('atmegaboot')
  })

  it('на чужой скорости не подключается и закрывает порт', async () => {
    const emu = new Stk500Emulator({ bootloader: 'atmegaboot' })
    await expect(connectAvr(emu, 115200)).rejects.toThrow(/не отвечает/)
    expect(emu.opened).toBeNull()
  })

  it('чужой чип — UnsupportedChipError с сигнатурой', async () => {
    const emu = new Stk500Emulator({ bootloader: 'optiboot', signature: [0x1e, 0x98, 0x01] })
    await expect(connectAvr(emu, 115200)).rejects.toSatisfy(
      (e: unknown) => e instanceof UnsupportedChipError && /1E 98 01/.test((e as Error).message),
    )
  })
})

describe('AvrDriver.read', () => {
  it('читает всю flash и сообщает, что Optiboot не отдаёт EEPROM', async () => {
    const emu = new Stk500Emulator({ bootloader: 'optiboot' })
    randomFlash(emu)
    const d = await connectAvr(emu, 115200)
    const progress: number[] = []
    const r = await d.read({ kind: 'full' }, (done, total) => progress.push(done / total), live())
    expect(Array.from(r.data)).toEqual(Array.from(emu.flash))
    expect(r.baseAddress).toBe(0)
    expect(r.eeprom).toBeUndefined()
    expect(r.notes.join()).toMatch(/EEPROM/)
    expect(progress.at(-1)).toBe(1)
  })

  it('у старого загрузчика читает и EEPROM', async () => {
    const emu = new Stk500Emulator({ bootloader: 'atmegaboot' })
    emu.eeprom.fill(0x42, 0, 16)
    const d = await connectAvr(emu, 57600)
    const r = await d.read({ kind: 'full' }, noop, live())
    expect(Array.from(r.eeprom!)).toEqual(Array.from(emu.eeprom))
  })

  it('две операции подряд работают — плата каждый раз заново входит в загрузчик', async () => {
    const emu = new Stk500Emulator({ bootloader: 'optiboot' })
    const d = await connectAvr(emu, 115200)
    await d.read({ kind: 'full' }, noop, live())
    await expect(d.read({ kind: 'full' }, noop, live())).resolves.toBeTruthy()
  })

  it('останавливается по «Стоп»', async () => {
    const d = await connectAvr(new Stk500Emulator({ bootloader: 'optiboot' }), 115200)
    const ctl = new AbortController()
    ctl.abort()
    await expect(d.read({ kind: 'full' }, noop, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('для Arduino нет чтения «только приложения»', async () => {
    const d = await connectAvr(new Stk500Emulator({ bootloader: 'optiboot' }), 115200)
    await expect(d.read({ kind: 'app' }, noop, live())).rejects.toThrow(/только/)
  })
})

describe('AvrDriver.write', () => {
  it('пишет всю область приложения, не трогает загрузчик и стирает хвост старой прошивки', async () => {
    const emu = new Stk500Emulator({ bootloader: 'optiboot' })
    randomFlash(emu) // «старая» прошивка и загрузчик
    const bootloader = emu.flash.slice(appAreaEnd('optiboot'))
    const d = await connectAvr(emu, 115200)
    const image = new Uint8Array(0x8000).fill(0xff)
    image.fill(0x11, 0, 1000)
    image.fill(0x99, appAreaEnd('optiboot')) // «чужой» загрузчик в файле должен быть пропущен
    await d.write(image, 0, noop, live())
    expect(Array.from(emu.flash.subarray(0, 1000))).toEqual(new Array(1000).fill(0x11))
    expect(emu.flash.subarray(1000, appAreaEnd('optiboot')).every((b) => b === 0xff)).toBe(true)
    expect(Array.from(emu.flash.subarray(appAreaEnd('optiboot')))).toEqual(Array.from(bootloader))
    expect(emu.pageWrites).toBe(appAreaEnd('optiboot') / ATMEGA328P.pageSize)
  })

  it('короткий файл дополняется 0xFF', async () => {
    const emu = new Stk500Emulator({ bootloader: 'atmegaboot' })
    randomFlash(emu)
    const d = await connectAvr(emu, 57600)
    await d.write(Uint8Array.of(1, 2, 3), 0, noop, live())
    expect(Array.from(emu.flash.subarray(0, 4))).toEqual([1, 2, 3, 0xff])
    expect(appAreaEnd('atmegaboot')).toBe(0x7800)
    expect(appAreaEnd('unknown')).toBe(0x7800)
  })

  it('скетч с Uno (до 0x7E00) не обрезается молча на плате со старым загрузчиком', async () => {
    const emu = new Stk500Emulator({ bootloader: 'atmegaboot' })
    const d = await connectAvr(emu, 57600)
    const big = new Uint8Array(0x7a00).fill(0x33)
    await expect(d.write(big, 0, noop, live())).rejects.toThrow(/не помещается/)
    expect(emu.pageWrites).toBe(0)
  })

  it('битая запись ловится проверкой', async () => {
    const d = await connectAvr(new Stk500Emulator({ bootloader: 'optiboot', corruptWrites: true }), 115200)
    await expect(d.write(new Uint8Array(256), 0, noop, live())).rejects.toBeInstanceOf(VerifyError)
  })

  it('адрес не с нуля — ошибка', async () => {
    const d = await connectAvr(new Stk500Emulator({ bootloader: 'optiboot' }), 115200)
    await expect(d.write(new Uint8Array(4), 0x100, noop, live())).rejects.toThrow(/адреса 0/)
  })
})
