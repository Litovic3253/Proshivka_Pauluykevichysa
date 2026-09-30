import { describe, expect, it } from 'vitest'
import { WebSerialTransport } from '@/serial/webSerialTransport'
import { SerialTimeoutError } from '@/serial/transport'

/** Поддельный SerialPort на web streams Node 20. */
function fakePort() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const written: number[] = []
  const signals: SerialOutputSignals[] = []
  const opened: number[] = []
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    async open(o: SerialOptions) {
      opened.push(o.baudRate)
      port.readable = new ReadableStream<Uint8Array>({ start: (c) => { controller = c } })
      port.writable = new WritableStream<Uint8Array>({ write: (chunk) => { written.push(...chunk) } })
    },
    async close() {
      port.readable = null
      port.writable = null
    },
    async setSignals(s: SerialOutputSignals) {
      signals.push(s)
    },
    getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
  }
  return {
    port: port as unknown as SerialPort,
    push: (...b: number[]) => controller.enqueue(Uint8Array.from(b)),
    fail: (e: Error) => controller.error(e),
    written,
    signals,
    opened,
  }
}

describe('WebSerialTransport', () => {
  it('собирает ровно n байт из нескольких кусков', async () => {
    const f = fakePort()
    const t = new WebSerialTransport(f.port)
    await t.open(115200)
    f.push(0x14)
    setTimeout(() => f.push(0x10, 0x99), 10)
    expect(Array.from(await t.read(2, 500))).toEqual([0x14, 0x10])
    expect(Array.from(await t.read(1, 500))).toEqual([0x99])
    expect(f.opened).toEqual([115200])
    await t.close()
  })

  it('бросает SerialTimeoutError, если данных нет', async () => {
    const f = fakePort()
    const t = new WebSerialTransport(f.port)
    await t.open(57600)
    await expect(t.read(1, 30)).rejects.toBeInstanceOf(SerialTimeoutError)
    await t.close()
  })

  it('пишет байты и выставляет DTR/RTS', async () => {
    const f = fakePort()
    const t = new WebSerialTransport(f.port)
    await t.open(115200)
    await t.write(Uint8Array.of(0x30, 0x20))
    await t.setSignals({ dtr: false, rts: false })
    await t.setSignals({ dtr: true })
    expect(f.written).toEqual([0x30, 0x20])
    expect(f.signals).toEqual([{ dataTerminalReady: false, requestToSend: false }, { dataTerminalReady: true }])
    await t.close()
  })

  it('drain выбрасывает накопленный мусор', async () => {
    const f = fakePort()
    const t = new WebSerialTransport(f.port)
    await t.open(115200)
    f.push(1, 2, 3)
    await t.drain(10)
    f.push(4)
    expect(Array.from(await t.read(1, 100))).toEqual([4])
    await t.close()
  })

  it('ошибка порта (кабель выдернули) доходит до read', async () => {
    const f = fakePort()
    const t = new WebSerialTransport(f.port)
    await t.open(115200)
    const pending = t.read(1, 1000)
    f.fail(new DOMException('The device has been lost.', 'NetworkError'))
    await expect(pending).rejects.toMatchObject({ name: 'NetworkError' })
    await t.close()
  })

  it('после close можно открыть снова на другой скорости', async () => {
    const f = fakePort()
    const t = new WebSerialTransport(f.port)
    await t.open(115200)
    await t.close()
    await t.open(57600)
    f.push(7)
    expect(Array.from(await t.read(1, 100))).toEqual([7])
    expect(f.opened).toEqual([115200, 57600])
    await t.close()
  })
})
