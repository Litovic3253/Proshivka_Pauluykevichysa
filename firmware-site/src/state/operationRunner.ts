import { explainError, type ExplainedError } from '@/drivers/explainError'
import type { Progress } from '@/drivers/types'

export interface OpState {
  label: string
  done: number
  total: number
  startedAt: number
  cancellable: boolean
}

export type RunResult<T> = { ok: true; value: T } | { ok: false; error: ExplainedError }

/** Одна операция с платой за раз: прогресс, «Стоп» и перевод ошибок в понятный текст. */
export class OperationRunner {
  private current: { state: OpState; controller: AbortController } | null = null
  private readonly listeners = new Set<() => void>()

  constructor(private readonly now: () => number = Date.now) {}

  getState = (): OpState | null => this.current?.state ?? null

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  async run<T>(
    label: string,
    fn: (onProgress: Progress, signal: AbortSignal) => Promise<T>,
    opts: { cancellable?: boolean } = {},
  ): Promise<RunResult<T>> {
    if (this.current) {
      return { ok: false, error: { title: 'Уже идёт другая операция', hint: 'Дождитесь окончания или нажмите «Стоп».', raw: '' } }
    }
    const controller = new AbortController()
    const mine = { state: { label, done: 0, total: 0, startedAt: this.now(), cancellable: opts.cancellable ?? true }, controller }
    this.current = mine
    this.emit()
    const onProgress: Progress = (done, total) => {
      if (this.current !== mine) return
      mine.state = { ...mine.state, done, total }
      this.emit()
    }
    try {
      return { ok: true, value: await fn(onProgress, controller.signal) }
    } catch (e) {
      return { ok: false, error: explainError(e) }
    } finally {
      this.current = null
      this.emit()
    }
  }

  cancel(reason?: unknown): void {
    this.current?.controller.abort(reason)
  }
}
