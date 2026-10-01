import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import { allowPermission, isOwnPage } from '../../electron/guards.mjs'

const index = String.raw`C:\Program\resources\app.asar\dist\index.html`
const own = pathToFileURL(index).href

describe('guards', () => {
  it('окно остаётся только на своей странице', () => {
    expect(isOwnPage(own, index)).toBe(true)
    expect(isOwnPage(own + '#/library', index)).toBe(true)
    expect(isOwnPage('https://example.com/', index)).toBe(false)
    expect(isOwnPage('file:///C:/Users/x/Desktop/firmware.bin', index)).toBe(false)
    expect(isOwnPage('не адрес', index)).toBe(false)
  })

  it('разрешены только COM-порты и копирование в буфер', () => {
    expect(allowPermission('serial')).toBe(true)
    expect(allowPermission('clipboard-sanitized-write')).toBe(true)
    expect(allowPermission('media')).toBe(false)
    expect(allowPermission('geolocation')).toBe(false)
  })
})
