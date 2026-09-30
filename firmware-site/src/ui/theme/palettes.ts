/** Палитры один в один из Студии Паулюкевичуса (W/TGbot/app/theme.py). */
export interface Palette {
  name: string
  dark: boolean
  bg: string // фон окна
  card: string // фон карточек и меню
  fg: string // основной текст
  muted: string // приглушённый текст
  border: string // тонкие рамки карточек
  subtle: string // выбранный пункт меню, подложки
  line: string // рамки полей ввода
  accent: string // кнопки, логотип
  syntax: [string, string, string] // превью в окне выбора темы
}

const p = (name: string, dark: boolean, bg: string, card: string, fg: string, muted: string, border: string,
  subtle: string, line: string, accent: string, syntax: [string, string, string]): Palette =>
  ({ name, dark, bg, card, fg, muted, border, subtle, line, accent, syntax })

export const PALETTES: Record<string, Palette> = {
  light: p('Светлая', false, '#FAFAFA', '#FFFFFF', '#09090B', '#71717A', '#E4E4E7', '#F4F4F5', '#D4D4D8', '#09090B', ['#7C3AED', '#059669', '#2563EB']),
  dark: p('Тёмная', true, '#0A0A0B', '#141417', '#FAFAFA', '#A1A1AA', '#27272A', '#1C1C20', '#3F3F46', '#FAFAFA', ['#C084FC', '#34D399', '#60A5FA']),
  github_light: p('GitHub Light', false, '#F6F8FA', '#FFFFFF', '#1F2328', '#656D76', '#D0D7DE', '#EAEEF2', '#AFB8C1', '#0969DA', ['#CF222E', '#0A3069', '#8250DF']),
  catppuccin_latte: p('Catppuccin Latte', false, '#E6E9EF', '#EFF1F5', '#4C4F69', '#6C6F85', '#CCD0DA', '#DCE0E8', '#BCC0CC', '#8839EF', ['#8839EF', '#40A02B', '#1E66F5']),
  solarized_light: p('Solarized Light', false, '#EEE8D5', '#FDF6E3', '#073642', '#657B83', '#DDD6C1', '#EEE8D5', '#C9C2AE', '#268BD2', ['#859900', '#2AA198', '#268BD2']),
  github_dark: p('GitHub Dark', true, '#010409', '#0D1117', '#E6EDF3', '#8D96A0', '#30363D', '#161B22', '#484F58', '#2F81F7', ['#FF7B72', '#A5D6FF', '#D2A8FF']),
  one_dark: p('One Dark Pro', true, '#21252B', '#282C34', '#ABB2BF', '#7F848E', '#3E4452', '#2C313A', '#4B5263', '#61AFEF', ['#C678DD', '#98C379', '#61AFEF']),
  dracula: p('Dracula', true, '#21222C', '#282A36', '#F8F8F2', '#A0A8CD', '#343746', '#44475A', '#6272A4', '#BD93F9', ['#FF79C6', '#F1FA8C', '#50FA7B']),
  monokai: p('Monokai', true, '#1E1F1C', '#272822', '#F8F8F2', '#A09F93', '#3E3D32', '#3E3D32', '#575852', '#A6E22E', ['#F92672', '#E6DB74', '#A6E22E']),
  tokyo_night: p('Tokyo Night', true, '#16161E', '#1A1B26', '#C0CAF5', '#787C99', '#292E42', '#24283B', '#3B4261', '#7AA2F7', ['#BB9AF7', '#9ECE6A', '#7AA2F7']),
  catppuccin_mocha: p('Catppuccin Mocha', true, '#11111B', '#1E1E2E', '#CDD6F4', '#A6ADC8', '#313244', '#313244', '#45475A', '#CBA6F7', ['#CBA6F7', '#A6E3A1', '#89B4FA']),
  nord: p('Nord', true, '#2E3440', '#3B4252', '#ECEFF4', '#A5AFC2', '#434C5E', '#434C5E', '#4C566A', '#88C0D0', ['#81A1C1', '#A3BE8C', '#88C0D0']),
  gruvbox_dark: p('Gruvbox Dark', true, '#1D2021', '#282828', '#EBDBB2', '#A89984', '#3C3836', '#32302F', '#504945', '#FABD2F', ['#FB4934', '#B8BB26', '#8EC07C']),
  night_owl: p('Night Owl', true, '#010E1A', '#011627', '#D6DEEB', '#8BA3B8', '#122D42', '#0B2942', '#1D3B53', '#82AAFF', ['#C792EA', '#ECC48D', '#82AAFF']),
  solarized_dark: p('Solarized Dark', true, '#00212B', '#002B36', '#EEE8D5', '#93A1A1', '#0F3B47', '#073642', '#2A5561', '#268BD2', ['#859900', '#2AA198', '#268BD2']),
}

export const SYSTEM_THEME = 'system'
export const SYSTEM_THEME_NAME = 'Как в системе'

export function resolvePalette(key: string, prefersDark: boolean): Palette {
  if (key === SYSTEM_THEME || !PALETTES[key]) return prefersDark ? PALETTES.dark : PALETTES.light
  return PALETTES[key]
}

/** Токены shadcn (background / card / foreground / muted / border + акцент) — как _scheme() в theme.py. */
export function paletteVars(pal: Palette): Record<string, string> {
  const onAccent = pal.dark ? pal.bg : '#FFFFFF'
  return {
    '--background': pal.bg,
    '--foreground': pal.fg,
    '--card': pal.card,
    '--card-foreground': pal.fg,
    '--popover': pal.card,
    '--popover-foreground': pal.fg,
    '--primary': pal.accent,
    '--primary-foreground': onAccent,
    '--secondary': pal.subtle,
    '--secondary-foreground': pal.fg,
    '--muted': pal.subtle,
    '--muted-foreground': pal.muted,
    '--accent': pal.subtle,
    '--accent-foreground': pal.fg,
    '--border': pal.border,
    '--input': pal.line,
    '--ring': pal.fg,
  }
}
