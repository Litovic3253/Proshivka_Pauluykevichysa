import { describe, expect, it } from 'vitest'
import { describePort } from '@/serial/portName'

describe('describePort', () => {
  it('узнаёт распространённые USB-адаптеры', () => {
    expect(describePort({ usbVendorId: 0x1a86, usbProductId: 0x7523 })).toBe('CH340 · USB 1A86:7523')
    expect(describePort({ usbVendorId: 0x10c4, usbProductId: 0xea60 })).toBe('CP2102 · USB 10C4:EA60')
    expect(describePort({ usbVendorId: 0x2341, usbProductId: 0x0043 })).toBe('Arduino Uno · USB 2341:0043')
    expect(describePort({ usbVendorId: 0x303a, usbProductId: 0x1001 })).toBe('ESP32 USB · USB 303A:1001')
  })

  it('неизвестный адаптер и порт без USB', () => {
    expect(describePort({ usbVendorId: 0x1234, usbProductId: 0x5678 })).toBe('USB-адаптер · USB 1234:5678')
    expect(describePort({})).toBe('Последовательный порт')
  })
})
