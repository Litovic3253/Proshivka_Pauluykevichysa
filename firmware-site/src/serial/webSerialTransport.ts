import { concatBytes } from '@/analysis/bytes'
import { type ByteTransport, SerialTimeoutError, sleep } from './transport'

export class WebSerialTransport implements ByteTransport {
  private buf = new Uint8Array(0)
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private loop: Promise<void> | null = null
  private failure: unknown = null
  private wake: (() => void) | null = null

  constructor(readonly port: SerialPort) {}

  async open(baud: number): Promise<void> {
    await this.port.open({ baudRate: baud, bufferSize: 64 * 1024 })
    this.buf = new Uint8Array(0)
    this.failure = null
    const readable = this.port.readable
    if (!readable) throw new Error('Порт открыт, но чтение из него недоступно')
    this.reader = readable.getReader()
    this.loop = this.readLoop(this.reader)
  }

  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value?.length) {
          this.buf = concatBytes(this.buf, value)
          this.wake?.()
        }
      }
    } catch (e) {
      this.failure = e
      this.wake?.()
    } finally {
      reader.releaseLock()
    }
  }

  async read(n: number, timeoutMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs
    while (this.buf.length < n) {
      if (this.failure) throw this.failure
      const left = deadline - Date.now()
      if (left <= 0) throw new SerialTimeoutError(n, this.buf.length)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left)
        this.wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
      this.wake = null
    }
    const out = this.buf.slice(0, n)
    this.buf = this.buf.slice(n)
    return out
  }

  async drain(quietMs = 50): Promise<void> {
    this.buf = new Uint8Array(0)
    await sleep(quietMs)
    this.buf = new Uint8Array(0)
  }

  async write(data: Uint8Array): Promise<void> {
    const writable = this.port.writable
    if (!writable) throw new Error('Порт закрыт')
    const writer = writable.getWriter()
    try {
      await writer.write(data)
    } finally {
      writer.releaseLock()
    }
  }

  async setSignals(s: { dtr?: boolean; rts?: boolean }): Promise<void> {
    const signals: SerialOutputSignals = {}
    if (s.dtr !== undefined) signals.dataTerminalReady = s.dtr
    if (s.rts !== undefined) signals.requestToSend = s.rts
    await this.port.setSignals(signals)
  }

  async close(): Promise<void> {
    await this.reader?.cancel().catch(() => {})
    await this.loop
    this.reader = null
    this.loop = null
    this.buf = new Uint8Array(0)
    await this.port.close().catch(() => {})
  }
}
