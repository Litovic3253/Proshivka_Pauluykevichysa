/** Байтовый канал к плате. Реализации: WebSerialTransport (браузер) и эмулятор загрузчика в тестах. */
export interface ByteTransport {
  open(baud: number): Promise<void>
  close(): Promise<void>
  write(data: Uint8Array): Promise<void>
  /** Ровно n байт или SerialTimeoutError. */
  read(n: number, timeoutMs: number): Promise<Uint8Array>
  /** Выбросить всё, что уже пришло, и то, что придёт за quietMs. */
  drain(quietMs?: number): Promise<void>
  setSignals(s: { dtr?: boolean; rts?: boolean }): Promise<void>
}

export class SerialTimeoutError extends Error {
  constructor(expected: number, got: number) {
    super(`Плата не ответила вовремя: ждали ${expected} байт, пришло ${got}`)
    this.name = 'SerialTimeoutError'
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
