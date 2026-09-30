import { describe, expect, it } from 'vitest'
import { DisconnectGuard } from '@/state/disconnectGuard'

describe('DisconnectGuard', () => {
  it('отключение сразу после «Отключить»/заливки — перезагрузка платы с родным USB, а не выдернутый кабель', () => {
    let now = 1000
    const g = new DisconnectGuard(() => now, 5000)
    expect(g.isCableLoss()).toBe(true)
    g.expect()
    now += 3000
    expect(g.isCableLoss()).toBe(false)
    now += 3000
    expect(g.isCableLoss()).toBe(true)
  })
})
