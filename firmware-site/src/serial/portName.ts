import type { PortChoice } from '@/bridge'

/**
 * Подписи портов. Сам SerialPort знает только USB VID:PID, поэтому номер COM берётся
 * из окна выбора порта программы (describeElectronPort); describePort — запасной вариант.
 */
const KNOWN_ADAPTERS: Record<string, string> = {
  '1A86:7523': 'CH340',
  '1A86:7522': 'CH340K',
  '1A86:55D4': 'CH9102',
  '10C4:EA60': 'CP2102',
  '0403:6001': 'FTDI FT232R',
  '0403:6015': 'FTDI FT231X',
  '2341:0043': 'Arduino Uno',
  '2341:0001': 'Arduino Uno',
  '2341:0243': 'Arduino Uno',
  '2A03:0043': 'Arduino Uno',
  '303A:1001': 'ESP32 USB',
  '303A:0002': 'ESP32-S2 USB',
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')

export function describePort(info: Partial<SerialPortInfo>): string {
  if (info.usbVendorId === undefined) return 'Последовательный порт'
  const vid = hex4(info.usbVendorId)
  const pid = info.usbProductId === undefined ? '????' : hex4(info.usbProductId)
  return `${KNOWN_ADAPTERS[`${vid}:${pid}`] ?? 'USB-адаптер'} · USB ${vid}:${pid}`
}

/** Подпись порта в окне выбора: «COM5 · CH340 · USB 1A86:7523». */
export function describeElectronPort(p: PortChoice): string {
  const parts = [p.portName]
  const vid = p.vendorId !== undefined ? Number(p.vendorId) : NaN
  const pid = p.productId !== undefined ? Number(p.productId) : NaN
  if (Number.isFinite(vid) && Number.isFinite(pid)) {
    const key = `${hex4(vid)}:${hex4(pid)}`
    parts.push(KNOWN_ADAPTERS[key] ?? p.displayName ?? 'USB-адаптер', `USB ${key}`)
  } else if (p.displayName) {
    parts.push(p.displayName)
  }
  return parts.join(' · ')
}
