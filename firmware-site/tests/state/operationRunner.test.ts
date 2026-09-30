import { describe, expect, it } from 'vitest'
import { OperationRunner } from '@/state/operationRunner'
import { DeviceLostError } from '@/drivers/errors'

describe('OperationRunner', () => {
  it('ведёт прогресс и сообщает подписчикам', async () => {
    const r = new OperationRunner(() => 1000)
    const seen: (string | null)[] = []
    r.subscribe(() => {
      const s = r.getState()
      seen.push(s ? `${s.label}:${s.done}/${s.total}` : null)
    })
    const res = await r.run('Чтение', async (p) => {
      p(1, 2)
      p(2, 2)
      return 42
    })
    expect(res).toEqual({ ok: true, value: 42 })
    expect(seen).toEqual(['Чтение:0/0', 'Чтение:1/2', 'Чтение:2/2', null])
    expect(r.getState()).toBeNull()
  })

  it('не запускает вторую операцию одновременно', async () => {
    const r = new OperationRunner()
    let release!: () => void
    const first = r.run('Первая', () => new Promise<void>((resolve) => (release = resolve)))
    const second = await r.run('Вторая', async () => 1)
    expect(second).toMatchObject({ ok: false, error: { title: 'Уже идёт другая операция' } })
    release()
    expect((await first).ok).toBe(true)
  })

  it('«Стоп» прерывает операцию', async () => {
    const r = new OperationRunner()
    const pending = r.run('Долгая', (_p, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))))
    r.cancel()
    expect(await pending).toMatchObject({ ok: false, error: { title: 'Операция остановлена' } })
  })

  it('отключение кабеля передаётся как причина отмены', async () => {
    const r = new OperationRunner()
    const pending = r.run('Долгая', (_p, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))))
    r.cancel(new DeviceLostError())
    expect(await pending).toMatchObject({ ok: false, error: { title: 'Кабель отключён' } })
  })

  it('выдернутый кабель завершает зависшую операцию сразу, не дожидаясь таймаута esptool', async () => {
    const r = new OperationRunner()
    const pending = r.run('Чтение', () => new Promise(() => {}))
    r.cancel(new DeviceLostError())
    expect(await pending).toMatchObject({ ok: false, error: { title: 'Кабель отключён' } })
    expect(r.getState()).toBeNull()
  }, 1000)

  it('после отключения кабеля ошибка драйвера показывается как «Кабель отключён»', async () => {
    const r = new OperationRunner()
    const pending = r.run('Запись', (_p, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Порт закрыт')))))
    r.cancel(new DeviceLostError())
    expect(await pending).toMatchObject({ ok: false, error: { title: 'Кабель отключён' } })
  })

  it('ошибки переводятся в понятный текст', async () => {
    const r = new OperationRunner()
    const res = await r.run('x', async () => {
      throw new Error('Раздел «nvs» не найден')
    })
    expect(res).toMatchObject({ ok: false, error: { title: 'Раздел «nvs» не найден' } })
  })
})
