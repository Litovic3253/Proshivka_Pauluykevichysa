import { describe, expect, it } from 'vitest'
import { describeElectronPort, describePort } from '@/serial/portName'

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

describe('describeElectronPort', () => {
  it('COM-номер, адаптер и USB (Electron отдаёт VID/PID десятичными строками)', () => {
    expect(describeElectronPort({ portId: '1', portName: 'COM5', displayName: 'USB-SERIAL CH340', vendorId: '6790', productId: '29987' })).toBe('COM5 · CH340 · USB 1A86:7523')
    expect(describeElectronPort({ portId: '2', portName: 'COM7', displayName: 'Silicon Labs CP210x USB to UART Bridge', vendorId: '4292', productId: '60000' })).toBe('COM7 · CP2102 · USB 10C4:EA60')
  })

  it('неизвестный адаптер — имя от Windows; порт без USB', () => {
    expect(describeElectronPort({ portId: '3', portName: 'COM9', displayName: 'Мой адаптер', vendorId: '4660', productId: '22136' })).toBe('COM9 · Мой адаптер · USB 1234:5678')
    expect(describeElectronPort({ portId: '4', portName: 'COM1', displayName: 'Communications Port' })).toBe('COM1 · Communications Port')
    expect(describeElectronPort({ portId: '5', portName: 'COM3' })).toBe('COM3')
  })
})
