/**
 * Web Serial не сообщает сайту номер COM-порта (его видно только в окне выбора Chrome),
 * поэтому порт подписывается по USB-адаптеру.
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
