import { WebSerialTransport } from '@/serial/webSerialTransport'
import { connectAvr } from './avr/avrDriver'
import { connectEsp32 } from './esp32/esp32Driver'
import { BoardNotFoundError, UnsupportedChipError } from './errors'
import type { BoardDriver } from './types'

export type Log = (line: string) => void
export type Probe = 'esp32' | 'avr115200' | 'avr57600'

const PROBE_LABELS: Record<Probe, string> = {
  esp32: 'ESP32',
  avr115200: 'Arduino (115200)',
  avr57600: 'Arduino (57600)',
}

const ESPRESSIF_VID = 0x303a
const SILABS_VID = 0x10c4

/** Проба AVR быстрая (~1,5 с), проба ESP32 долгая — поэтому AVR первой, если адаптер не «ESP-шный». */
export function probeOrder(info: Partial<SerialPortInfo>): Probe[] {
  const espFirst = info.usbVendorId === ESPRESSIF_VID || info.usbVendorId === SILABS_VID
  return espFirst ? ['esp32', 'avr115200', 'avr57600'] : ['avr115200', 'avr57600', 'esp32']
}

export interface DetectDeps {
  esp32(port: SerialPort, log: Log): Promise<BoardDriver>
  avr(port: SerialPort, baud: number): Promise<BoardDriver>
}

export const defaultDetectDeps: DetectDeps = {
  esp32: (port, log) => connectEsp32(port, log),
  avr: (port, baud) => connectAvr(new WebSerialTransport(port), baud),
}

/** Порт открыт другой программой или уже открыт на этой странице — перебирать дальше бессмысленно. */
export function isPortBusy(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name
  const message = e instanceof Error ? e.message : ''
  return name === 'InvalidStateError' || (name === 'NetworkError' && /open/i.test(message))
}

export async function detectBoard(port: SerialPort, log: Log, deps: DetectDeps = defaultDetectDeps): Promise<BoardDriver> {
  const attempts: string[] = []
  for (const probe of probeOrder(port.getInfo())) {
    log(`Пробую: ${PROBE_LABELS[probe]}`)
    try {
      return probe === 'esp32' ? await deps.esp32(port, log) : await deps.avr(port, probe === 'avr115200' ? 115200 : 57600)
    } catch (e) {
      if (e instanceof UnsupportedChipError || isPortBusy(e)) throw e
      const message = e instanceof Error ? e.message : String(e)
      attempts.push(`${PROBE_LABELS[probe]}: ${message}`)
      log(`${PROBE_LABELS[probe]} не ответила: ${message}`)
    }
  }
  throw new BoardNotFoundError(attempts)
}
