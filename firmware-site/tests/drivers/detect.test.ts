import { describe, expect, it } from 'vitest'
import { detectBoard, probeOrder, type DetectDeps } from '@/drivers/detect'
import { BoardNotFoundError, UnsupportedChipError } from '@/drivers/errors'
import type { BoardDriver } from '@/drivers/types'

const portWith = (usbVendorId?: number) => ({ getInfo: () => ({ usbVendorId, usbProductId: 1 }) }) as unknown as SerialPort
const fakeDriver = (chip: string) => ({ info: { chip } }) as unknown as BoardDriver
const noop = () => {}

function deps(results: { esp32?: BoardDriver | Error; avr115200?: BoardDriver | Error; avr57600?: BoardDriver | Error }) {
  const calls: string[] = []
  const settle = (r: BoardDriver | Error | undefined) =>
    r instanceof Error ? Promise.reject(r) : r ? Promise.resolve(r) : Promise.reject(new Error('нет ответа'))
  const d: DetectDeps = {
    esp32: async () => {
      calls.push('esp32')
      return settle(results.esp32)
    },
    avr: async (_p, baud) => {
      calls.push(`avr${baud}`)
      return settle(baud === 115200 ? results.avr115200 : results.avr57600)
    },
  }
  return { d, calls }
}

describe('probeOrder', () => {
  it('Espressif и CP210x — сначала ESP32, остальные — сначала AVR', () => {
    expect(probeOrder({ usbVendorId: 0x303a })[0]).toBe('esp32')
    expect(probeOrder({ usbVendorId: 0x10c4 })[0]).toBe('esp32')
    expect(probeOrder({ usbVendorId: 0x1a86 })).toEqual(['avr115200', 'avr57600', 'esp32'])
    expect(probeOrder({})).toEqual(['avr115200', 'avr57600', 'esp32'])
  })
})

describe('detectBoard', () => {
  it('возвращает первый ответивший драйвер', async () => {
    const { d, calls } = deps({ avr57600: fakeDriver('ATmega328P') })
    const driver = await detectBoard(portWith(0x1a86), noop, d)
    expect(driver.info.chip).toBe('ATmega328P')
    expect(calls).toEqual(['avr115200', 'avr57600'])
  })

  it('никто не ответил — BoardNotFoundError со всеми попытками', async () => {
    const { d } = deps({})
    await expect(detectBoard(portWith(0x1a86), noop, d)).rejects.toSatisfy(
      (e: unknown) => e instanceof BoardNotFoundError && e.attempts.length === 3,
    )
  })

  it('неподдерживаемый чип останавливает перебор', async () => {
    const { d, calls } = deps({ avr115200: new UnsupportedChipError('сигнатура 1E 98 01') })
    await expect(detectBoard(portWith(0x1a86), noop, d)).rejects.toBeInstanceOf(UnsupportedChipError)
    expect(calls).toEqual(['avr115200'])
  })

  it('занятый порт останавливает перебор', async () => {
    const busy = new DOMException('Failed to open serial port.', 'NetworkError')
    const { d, calls } = deps({ esp32: busy })
    await expect(detectBoard(portWith(0x10c4), noop, d)).rejects.toBe(busy)
    expect(calls).toEqual(['esp32'])
  })
})
