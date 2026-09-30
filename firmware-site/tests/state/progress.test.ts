import { describe, expect, it } from 'vitest'
import { etaSeconds, formatEta, percent } from '@/state/progress'

describe('progress', () => {
  it('оценивает оставшееся время по средней скорости', () => {
    expect(etaSeconds(25, 100, 0, 10_000)).toBe(30)
    expect(etaSeconds(0, 100, 0, 10_000)).toBeNull()
    expect(etaSeconds(50, 100, 0, 500)).toBeNull() // меньше секунды — рано судить
    expect(etaSeconds(100, 100, 0, 10_000)).toBeNull()
  })

  it('пишет время по-русски', () => {
    expect(formatEta(40)).toBe('ещё ~40 с')
    expect(formatEta(0)).toBe('ещё ~1 с')
    expect(formatEta(150)).toBe('ещё ~3 мин')
    expect(formatEta(null)).toBe('')
  })

  it('процент не выходит за 100', () => {
    expect(percent(1, 3)).toBe(33)
    expect(percent(5, 4)).toBe(100)
    expect(percent(1, 0)).toBe(0)
  })
})
