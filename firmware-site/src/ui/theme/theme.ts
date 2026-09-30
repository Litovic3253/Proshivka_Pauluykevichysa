import { useEffect, useState } from 'react'
import { paletteVars, resolvePalette, SYSTEM_THEME } from './palettes'

const STORAGE_KEY = 'pauluk-fw-theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function loadThemeKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? SYSTEM_THEME
  } catch {
    return SYSTEM_THEME
  }
}

export function saveThemeKey(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key)
  } catch {
    // приватный режим — тема просто не запомнится
  }
}

export function applyTheme(key: string): void {
  const pal = resolvePalette(key, window.matchMedia(DARK_QUERY).matches)
  const root = document.documentElement
  for (const [name, value] of Object.entries(paletteVars(pal))) root.style.setProperty(name, value)
  root.classList.toggle('dark', pal.dark)
  root.style.colorScheme = pal.dark ? 'dark' : 'light'
}

export function useTheme(): readonly [string, (key: string) => void] {
  const [key, setKey] = useState(loadThemeKey)
  useEffect(() => {
    applyTheme(key)
    if (key !== SYSTEM_THEME) return
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = () => applyTheme(key)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [key])
  const choose = (next: string) => {
    saveThemeKey(next)
    setKey(next)
  }
  return [key, choose] as const
}
