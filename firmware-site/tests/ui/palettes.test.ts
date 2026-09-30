import { describe, expect, it } from 'vitest'
import { PALETTES, paletteVars, resolvePalette, SYSTEM_THEME } from '@/ui/theme/palettes'

describe('palettes', () => {
  it('все 15 тем Студии', () => {
    expect(Object.keys(PALETTES)).toEqual([
      'light', 'dark', 'github_light', 'catppuccin_latte', 'solarized_light', 'github_dark', 'one_dark',
      'dracula', 'monokai', 'tokyo_night', 'catppuccin_mocha', 'nord', 'gruvbox_dark', 'night_owl', 'solarized_dark',
    ])
  })

  it('«Как в системе» и неизвестный ключ — светлая или тёмная', () => {
    expect(resolvePalette(SYSTEM_THEME, true).name).toBe('Тёмная')
    expect(resolvePalette(SYSTEM_THEME, false).name).toBe('Светлая')
    expect(resolvePalette('нет такой', false).name).toBe('Светлая')
    expect(resolvePalette('dracula', false).name).toBe('Dracula')
  })

  it('переменные shadcn как в theme.py: текст на акценте — фон тёмной темы или белый', () => {
    const d = paletteVars(PALETTES.dracula)
    expect(d['--primary']).toBe('#BD93F9')
    expect(d['--primary-foreground']).toBe('#21222C')
    expect(d['--background']).toBe('#21222C')
    expect(d['--card']).toBe('#282A36')
    expect(d['--muted-foreground']).toBe('#A0A8CD')
    expect(paletteVars(PALETTES.light)['--primary-foreground']).toBe('#FFFFFF')
  })
})
