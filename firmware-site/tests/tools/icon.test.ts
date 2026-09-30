import { describe, expect, it } from 'vitest'
import { iconSvg, renderPng } from '../../tools/make-icon.mjs'
import { Resvg } from '@resvg/resvg-js'

function pixel(size: number, x: number, y: number): number[] {
  const img = new Resvg(iconSvg(), { fitTo: { mode: 'width', value: size } }).render()
  const i = (y * img.width + x) * 4
  return Array.from(img.pixels.subarray(i, i + 4))
}

describe('иконка', () => {
  it('жёлтый скруглённый квадрат Студии с тёмной микросхемой по центру', () => {
    expect(pixel(256, 2, 2)[3]).toBe(0) // угол прозрачный
    expect(pixel(256, 40, 128)).toEqual([0xfa, 0xbd, 0x2f, 255]) // жёлтый фон
    expect(pixel(256, 128, 128)).toEqual([0x1d, 0x20, 0x21, 255]) // тёмное ядро микросхемы
  })

  it('PNG нужного размера', () => {
    const png = renderPng(64)
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(64) // ширина из IHDR
  })
})
