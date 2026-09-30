import { describe, expect, it } from 'vitest'
import { parseRoute } from '@/ui/routing'

describe('parseRoute', () => {
  it('разбирает адреса страниц', () => {
    expect(parseRoute('')).toEqual({ page: 'device' })
    expect(parseRoute('#/library')).toEqual({ page: 'library' })
    expect(parseRoute('#/analysis/12')).toEqual({ page: 'analysis', id: 12 })
    expect(parseRoute('#/analysis')).toEqual({ page: 'analysis', id: null })
    expect(parseRoute('#/flash/3')).toEqual({ page: 'flash', id: 3 })
    expect(parseRoute('#/flash/abc')).toEqual({ page: 'flash', id: null })
    expect(parseRoute('#/чепуха')).toEqual({ page: 'device' })
  })
})
