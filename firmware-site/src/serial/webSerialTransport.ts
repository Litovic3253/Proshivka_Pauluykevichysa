import { concatBytes } from '@/analysis/bytes'
import { type ByteTransport, SerialTimeoutError, sleep } from './transport'

/** Ошибки линии, после которых Web Serial подставляет новый port.readable, — порт жив. */
const NON_FATAL_ERRORS = new Set(['FramingError', 'BreakError', 'ParityError', 'BufferOverrunError'])
/** Между операциями скетч может печатать без остановки — храним только хвост. */
const MAX_BUFFER = 64 * 1024

export class WebSerialTransport implements ByteTransport {
  private buf = new Uint8Array(0)
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private loop: Promise<void> | null = null
  private failure: unknown = null
  private wake: (() => void) | null = null
  private closing = false

  constructor(readonly port: SerialPort) {}

  async open(baud: number): Promise<void> {
    await this.port.open({ baudRate: baud, bufferSize: 64 * 1024 })
    this.buf = new Uint8Array(0)
    this.failure = null
    this.closing = false
    if (!this.port.readable) throw new Error('Порт открыт, но чтение из него недоступно')
    this.loop = this.readLoop()
  }

  private async readLoop(): Promise<void> {
    while (this.port.readable && !this.closing) {
      const reader = this.port.readable.getReader()
      this.reader = reader
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) return
          if (value?.length) {
            const next = concatBytes(this.buf, value)
            this.buf = next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER) : next
            this.wake?.()
          }
        }
      } catch (e) {
        if (NON_FATAL_ERRORS.has((e as { name?: string } | null)?.name ?? '')) continue
        this.failure = e
        this.wake?.()
        return
      } finally {
        reader.releaseLock()
      }
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
    this.closing = true
    await this.reader?.cancel().catch(() => {})
    await this.loop
    this.reader = null
    this.loop = null
    this.buf = new Uint8Array(0)
    await this.port.close().catch(() => {})
  }
}
