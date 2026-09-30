# Прошивки Паулюкевичуса — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Статический сайт на React, который через Web Serial определяет подключённую Arduino (ATmega328P) или ESP32/S2/S3/C3, считывает прошивку, даёт её скачать, хранит в библиотеке в браузере, показывает, что внутри, и заливает на другую плату.

**Architecture:** Всё работает в браузере, сервера нет. Слои: `serial/` (байтовый транспорт поверх Web Serial) → `drivers/` (единый интерфейс `BoardDriver`: свой STK500v1 для AVR, `esptool-js` для ESP32, автоопределение) → `analysis/` и `flash/` (чистые функции над `Uint8Array`) → `library/` (IndexedDB через Dexie) → `state/` (подключение и текущая операция) → `ui/` (React + shadcn/ui, стиль и темы Студии Паулюкевичуса).

**Tech Stack:** Vite 6, React 18/19 (как в шаблоне), TypeScript strict, Tailwind CSS 4, shadcn/ui (Radix), esptool-js 0.7.0, Dexie 4 + dexie-react-hooks, spark-md5, @tanstack/react-virtual, lucide-react, Vitest 3, fake-indexeddb, PlatformIO (только для сборки тестовых прошивок).

**Spec:** `docs/superpowers/specs/2026-09-30-firmware-reader-design.md`

Все пути ниже — относительно корня репозитория `C:\Users\mpavl\OneDrive\Рабочий стол\W\Узнай прошику`. Сайт живёт в `firmware-site/`; команды `npm …` выполняются из `firmware-site/`. Оболочка — Git Bash.

## Global Constraints

- Интерфейс, сообщения об ошибках и комментарии в коде — только на русском.
- Node 20.18 установлен на ПК → Vite **6** (Vite 7 требует Node ≥ 20.19). Не обновлять Vite до 7.
- `esptool-js` строго `0.7.0` (API сверено: `main`, `readFlash(addr,size,cb)`, `writeFlash(FlashOptions)`, `detectFlashSize`, `after`, `transport.disconnect`).
- Поддерживаемые чипы: ATmega328P (сигнатура `1E 95 0F`), ESP32, ESP32-S2, ESP32-S3, ESP32-C3. Остальное — ошибка «Чип не поддерживается».
- AVR: flash 32 КБ, страница 128 байт, EEPROM 1 КБ; область приложения до `0x7E00` (Optiboot) / `0x7800` (ATmegaBOOT и неизвестный).
- ESP32: таблица разделов `0x8000`, размер `0xC00`; загрузчик на `0x1000` у ESP32/S2 и `0x0` у S3/C3; паспорт `esp_app_desc_t` с магией `0xABCD5432` по смещению `0x20` от начала образа.
- Скорости ESP32: 921600 → 460800 → 115200. Скорости AVR: 115200, затем 57600.
- Чтение ESP32 кусками по `0x10000`, запись кусками по `0x40000`, `flashMode/flashFreq/flashSize: 'keep'`, проверка MD5.
- Web Serial не даёт номер COM-порта — порт подписывается по USB VID:PID (см. spec §4.1).
- Шрифт JetBrains Mono (файлы из `W/TGbot/assets/fonts`), карточки радиус 20 px, кнопки/поля 10 px, статусные цвета OK `#10B981`, WARN `#F59E0B`, ERR `#F43F5E`, IDLE `#A1A1AA`, DATA `#3B82F6`.
- Темы — ровно палитры из `W/TGbot/app/theme.py` + «Как в системе»; выбор хранится в `localStorage` под ключом `pauluk-fw-theme`.
- Хранилище IndexedDB: база `pauluk-firmware`, таблицы `records` и `blobs`.
- Локальный запуск: `http://localhost:5173` (`strictPort`).
- Коммиты только локальные, без `git push`.

## Review Focus

1. **Arduino после чтения «засыпает».** Optiboot выходит из загрузчика через ~1 с без команд, поэтому вторая операция подряд (чтение → запись) сломается, если драйвер не входит в загрузчик заново. Ожидание: каждая операция AVR сама сбрасывает плату и синхронизируется. Тест: «две операции подряд» в Task 5.
2. **Кабель выдернули посреди операции.** Ожидание: операция завершается ошибкой «Кабель отключён», статус серый, сайт не зависает. Тест: ошибка чтения транспорта пробрасывается в `read` (Task 4) и `DeviceLostError` переводится в понятный текст (Task 7).
3. **Порт занят Arduino IDE / монитором порта.** Ожидание: автоопределение не перебирает остальные варианты, а сразу говорит «Порт занят другой программой». Тест: `NetworkError` пробрасывается из `detectBoard` (Task 7).
4. **Заливка «только приложения» на плату с другим активным OTA-слотом.** Ожидание: запись идёт в активный раздел платы-получателя, иначе плата загрузит старую прошивку. Тест: `checkCompatibility` берёт адрес активного раздела (Task 9) и `activeAppPartition` читает otadata (Task 6).
5. **Файл с диска неизвестного формата / битый HEX.** Ожидание: понятная ошибка с номером строки для HEX, выбор чипа вручную для «сырого» `.bin`, без падения страницы. Тесты: битая контрольная сумма и мусор в Task 2, `identifyFile` для неизвестных байтов в Task 8.

---

### Task 1: Каркас проекта и байтовые помощники

**Files:**
- Create: `.gitignore`
- Create: `firmware-site/` (шаблон Vite react-ts)
- Modify: `firmware-site/vite.config.ts`, `firmware-site/tsconfig.json`, `firmware-site/tsconfig.app.json`, `firmware-site/package.json`, `firmware-site/index.html`
- Create: `firmware-site/src/index.css`, `firmware-site/src/assets/fonts/*`, `firmware-site/public/icon.png`
- Create: `firmware-site/src/analysis/bytes.ts`, `firmware-site/src/analysis/usage.ts`, `firmware-site/src/analysis/hash.ts`
- Create: `firmware-site/start.bat`
- Test: `firmware-site/tests/analysis/bytes.test.ts`

**Interfaces:**
- Produces:
  - `u16le(b: Uint8Array, o: number): number`, `u32le(b: Uint8Array, o: number): number`
  - `cString(b: Uint8Array, o: number, max: number): string`
  - `hexAddr(n: number, width?: number): string` → `'0x00008000'`
  - `hexBytes(b: ArrayLike<number>): string` → `'1E 95 0F'`
  - `formatSize(bytes: number): string` → `'512 Б' | '1,5 КБ' | '4 МБ'`
  - `concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array`
  - `sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean`
  - `toArrayBuffer(b: Uint8Array): ArrayBuffer`
  - `interface Usage { used: number; free: number; total: number; percent: number }`, `usage(data: Uint8Array, blockSize: number): Usage`
  - `sha256Hex(data: Uint8Array): Promise<string>`
  - Алиас импорта `@/` → `firmware-site/src/`

- [ ] **Step 1: Создать репозиторий и шаблон Vite**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git init
npm create vite@6 firmware-site -- --template react-ts
cd firmware-site
npm install
npm install esptool-js@0.7.0 dexie@4 dexie-react-hooks@1 spark-md5@3 lucide-react @tanstack/react-virtual@3
npm install -D tailwindcss@4 @tailwindcss/vite@4 vitest@3 fake-indexeddb@6 @types/w3c-web-serial @types/spark-md5 @types/node
```

Создать `.gitignore` в корне репозитория:

```gitignore
node_modules/
dist/
.pio/
*.log
.DS_Store
```

- [ ] **Step 2: Настроить Vite, алиас `@` и Vitest**

`firmware-site/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // esptool-js — ESM без "type": "module"; пусть Vite преобразует его для Node
    server: { deps: { inline: ['esptool-js'] } },
  },
})
```

В `firmware-site/tsconfig.json` добавить в корень объекта (нужно shadcn CLI):

```json
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
```

В `firmware-site/tsconfig.app.json` в `compilerOptions` добавить:

```json
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
```

В `firmware-site/package.json` в `scripts` добавить `"test": "vitest run"`.

- [ ] **Step 3: Шрифты, иконка, заголовок страницы**

```bash
mkdir -p src/assets/fonts public
cp "/c/Users/mpavl/OneDrive/Рабочий стол/W/TGbot/assets/fonts/"{JetBrainsMono-Regular.ttf,JetBrainsMono-Medium.ttf,OFL.txt} src/assets/fonts/
cp "/c/Users/mpavl/OneDrive/Рабочий стол/W/TGbot/assets/icon.png" public/icon.png
rm -f public/vite.svg src/assets/react.svg src/App.css
```

В `firmware-site/index.html`: `<html lang="ru">`, `<link rel="icon" type="image/png" href="/icon.png" />`, `<title>Прошивки Паулюкевичуса</title>`.

- [ ] **Step 4: Базовые стили (Tailwind 4 + токены shadcn)**

`firmware-site/src/index.css` (полностью заменить):

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

@font-face {
  font-family: "JetBrains Mono";
  src: url("./assets/fonts/JetBrainsMono-Regular.ttf") format("truetype");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("./assets/fonts/JetBrainsMono-Medium.ttf") format("truetype");
  font-weight: 500 700;
  font-display: swap;
}

/* Светлая тема Студии по умолчанию; остальные темы переопределяют эти переменные из JS (ui/theme). */
:root {
  --radius: 0.75rem; /* rounded-md у кнопок и полей = 10 px, как в Студии */
  --background: #FAFAFA;
  --foreground: #09090B;
  --card: #FFFFFF;
  --card-foreground: #09090B;
  --popover: #FFFFFF;
  --popover-foreground: #09090B;
  --primary: #09090B;
  --primary-foreground: #FFFFFF;
  --secondary: #F4F4F5;
  --secondary-foreground: #09090B;
  --muted: #F4F4F5;
  --muted-foreground: #71717A;
  --accent: #F4F4F5;
  --accent-foreground: #09090B;
  --destructive: #F43F5E;
  --border: #E4E4E7;
  --input: #D4D4D8;
  --ring: #09090B;
  --ok: #10B981;
  --warn: #F59E0B;
  --err: #F43F5E;
  --idle: #A1A1AA;
  --data: #3B82F6;
}

@theme inline {
  --font-sans: "JetBrains Mono", ui-monospace, monospace;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-ok: var(--ok);
  --color-warn: var(--warn);
  --color-err: var(--err);
  --color-idle: var(--idle);
  --color-data: var(--data);
}

@layer base {
  * { @apply border-border outline-ring/50; }
  html, body { @apply bg-background text-foreground font-sans antialiased; }
}
```

- [ ] **Step 5: Написать падающий тест байтовых помощников**

`firmware-site/tests/analysis/bytes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { concatBytes, cString, formatSize, hexAddr, hexBytes, sameBytes, u16le, u32le } from '@/analysis/bytes'
import { usage } from '@/analysis/usage'
import { sha256Hex } from '@/analysis/hash'

describe('bytes', () => {
  it('читает little-endian числа', () => {
    const b = Uint8Array.from([0x32, 0x54, 0xcd, 0xab])
    expect(u16le(b, 0)).toBe(0x5432)
    expect(u32le(b, 0)).toBe(0xabcd5432)
  })

  it('читает C-строку до нуля и до предела', () => {
    const b = new TextEncoder().encode('blink\0мусор')
    expect(cString(b, 0, 32)).toBe('blink')
    expect(cString(b, 0, 3)).toBe('bli')
  })

  it('форматирует адреса, байты и размеры по-русски', () => {
    expect(hexAddr(0x8000)).toBe('0x00008000')
    expect(hexAddr(0x1f, 2)).toBe('0x1F')
    expect(hexBytes([0x1e, 0x95, 0x0f])).toBe('1E 95 0F')
    expect(formatSize(512)).toBe('512 Б')
    expect(formatSize(1536)).toBe('1,5 КБ')
    expect(formatSize(4 * 1024 * 1024)).toBe('4 МБ')
  })

  it('склеивает и сравнивает массивы', () => {
    expect(Array.from(concatBytes(Uint8Array.of(1), Uint8Array.of(2, 3)))).toEqual([1, 2, 3])
    expect(sameBytes([1, 2], Uint8Array.of(1, 2))).toBe(true)
    expect(sameBytes([1, 2], [1, 3])).toBe(false)
    expect(sameBytes([1], [1, 2])).toBe(false)
  })
})

describe('usage', () => {
  it('считает занятые блоки, а не последний байт', () => {
    const data = new Uint8Array(4096 * 4).fill(0xff)
    data[10] = 0
    data[4096 * 3 + 5] = 1 // данные в конце flash, как SPIFFS у ESP32
    expect(usage(data, 4096)).toEqual({ used: 8192, free: 8192, total: 16384, percent: 50 })
  })

  it('пустая flash — 0 %', () => {
    expect(usage(new Uint8Array(256).fill(0xff), 128).percent).toBe(0)
  })
})

describe('sha256Hex', () => {
  it('считает SHA-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
```

- [ ] **Step 6: Запустить — тест падает**

Run: `npm test -- tests/analysis/bytes.test.ts`
Expected: FAIL — `Failed to resolve import "@/analysis/bytes"`.

- [ ] **Step 7: Реализовать помощники**

`firmware-site/src/analysis/bytes.ts`:

```ts
/** Мелкие помощники для разбора двоичных форматов прошивок. */

export function u16le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8)
}

export function u32le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}

/** Строка фиксированной длины, обрезанная по первому нулю (как char[] в C). */
export function cString(b: Uint8Array, o: number, max: number): string {
  let end = o
  while (end < o + max && end < b.length && b[end] !== 0) end++
  return new TextDecoder().decode(b.subarray(o, end))
}

export function hexAddr(n: number, width = 8): string {
  return '0x' + n.toString(16).toUpperCase().padStart(width, '0')
}

export function hexBytes(b: ArrayLike<number>): string {
  return Array.from(b, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

const sizeFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} КБ`
  return `${sizeFormat.format(bytes / 1024 / 1024)} МБ`
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

export function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Копия в отдельный ArrayBuffer — для Web Crypto, Blob и spark-md5. */
export function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  return b.slice().buffer as ArrayBuffer
}
```

`firmware-site/src/analysis/usage.ts`:

```ts
export interface Usage {
  used: number
  free: number
  total: number
  percent: number
}

/**
 * Занято = блоки, в которых есть хоть один байт не 0xFF. Разделы ESP32 разбросаны по flash,
 * поэтому считать «до последнего непустого байта» нельзя — SPIFFS в конце дал бы 100 %.
 */
export function usage(data: Uint8Array, blockSize: number): Usage {
  let used = 0
  for (let start = 0; start < data.length; start += blockSize) {
    const end = Math.min(start + blockSize, data.length)
    for (let i = start; i < end; i++) {
      if (data[i] !== 0xff) {
        used += end - start
        break
      }
    }
  }
  const total = data.length
  return { used, free: total - used, total, percent: total ? Math.round((used / total) * 100) : 0 }
}
```

`firmware-site/src/analysis/hash.ts`:

```ts
import { toArrayBuffer } from './bytes'

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(data))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
```

- [ ] **Step 8: Запустить — тест проходит**

Run: `npm test -- tests/analysis/bytes.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 9: Скрипт запуска**

`firmware-site/start.bat` (сохранить в UTF-8):

```bat
@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Первый запуск: устанавливаю зависимости...
  call npm install
  if errorlevel 1 (
    echo Не удалось установить зависимости.
    pause
    exit /b 1
  )
)
echo Сайт: http://localhost:5173  ^(откройте в Chrome, Edge или Яндекс Браузере^)
call npm run dev -- --open
```

Временно заменить `firmware-site/src/App.tsx` заглушкой, чтобы сборка проходила без удалённых файлов:

```tsx
export default function App() {
  return <main className="p-6">Прошивки Паулюкевичуса</main>
}
```

- [ ] **Step 10: Проверить сборку**

Run: `npm run build`
Expected: `✓ built in …`, без ошибок TypeScript.

- [ ] **Step 11: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add .gitignore docs firmware-site
git commit -m "feat: каркас сайта и байтовые помощники"
```

---

### Task 2: Intel HEX, поиск строк и тестовая прошивка Arduino

**Files:**
- Create: `firmware-site/src/analysis/intelHex.ts`
- Create: `firmware-site/src/analysis/strings.ts`
- Create: `firmware-site/tools/fixtures/avr-blink/platformio.ini`, `firmware-site/tools/fixtures/avr-blink/src/main.cpp`
- Create: `firmware-site/tests/fixtures/avr-blink.hex` (результат сборки)
- Create: `firmware-site/tests/helpers/fixtures.ts`
- Test: `firmware-site/tests/analysis/intelHex.test.ts`, `firmware-site/tests/analysis/strings.test.ts`

**Interfaces:**
- Consumes: `hexAddr` из Task 1.
- Produces:
  - `interface HexImage { data: Uint8Array; baseAddress: number }`
  - `parseIntelHex(text: string): HexImage` — бросает `Error('Строка N: …')`
  - `formatIntelHex(data: Uint8Array, baseAddress?: number): string`
  - `interface FoundString { address: number; text: string }`
  - `extractStrings(data: Uint8Array, baseAddress?: number, minLength?: number, limit?: number): FoundString[]`
  - Тестовый помощник `loadFixture(name: string): Uint8Array`, `loadFixtureText(name: string): string`

- [ ] **Step 1: Собрать тестовую прошивку Arduino**

`firmware-site/tools/fixtures/avr-blink/platformio.ini`:

```ini
; Эталонная прошивка для тестов разбора HEX и строк. Собирается PlatformIO с ПК.
[env:uno]
platform = atmelavr
board = uno
framework = arduino
```

`firmware-site/tools/fixtures/avr-blink/src/main.cpp`:

```cpp
#include <Arduino.h>

void setup() {
  Serial.begin(9600);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  Serial.println(F("Privet ot Paulukevichusa"));
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
```

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику/firmware-site"
/c/Users/mpavl/.platformio/penv/Scripts/pio.exe run -d tools/fixtures/avr-blink
mkdir -p tests/fixtures
cp tools/fixtures/avr-blink/.pio/build/uno/firmware.hex tests/fixtures/avr-blink.hex
```

Expected: `SUCCESS`, файл `tests/fixtures/avr-blink.hex` существует.

- [ ] **Step 2: Помощник загрузки фикстур**

`firmware-site/tests/helpers/fixtures.ts`:

```ts
import { readFileSync } from 'node:fs'

export function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))
}

export function loadFixtureText(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
}
```

- [ ] **Step 3: Написать падающие тесты**

`firmware-site/tests/analysis/intelHex.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatIntelHex, parseIntelHex } from '@/analysis/intelHex'
import { loadFixtureText } from '../helpers/fixtures'

describe('parseIntelHex', () => {
  it('разбирает запись данных и проверяет контрольную сумму', () => {
    const img = parseIntelHex(':100000000C9434000C943E000C943E000C943E0082\n:00000001FF\n')
    expect(img.baseAddress).toBe(0)
    expect(Array.from(img.data.subarray(0, 4))).toEqual([0x0c, 0x94, 0x34, 0x00])
    expect(img.data.length).toBe(16)
  })

  it('учитывает расширенный линейный адрес (тип 04)', () => {
    const img = parseIntelHex(':020000040001F9\n:0100000055AA\n:00000001FF\n')
    expect(img.baseAddress).toBe(0x10000)
    expect(Array.from(img.data)).toEqual([0x55])
  })

  it('сообщает номер строки при неверной контрольной сумме', () => {
    expect(() => parseIntelHex(':00000001FF\n'.replace('FF', 'FE'))).toThrow(/Строка 1: неверная контрольная сумма/)
  })

  it('отвергает не-HEX текст', () => {
    expect(() => parseIntelHex('hello world')).toThrow(/Строка 1: это не Intel HEX/)
  })

  it('отвергает файл без данных', () => {
    expect(() => parseIntelHex(':00000001FF\n')).toThrow(/нет данных/)
  })

  it('разбирает настоящую прошивку Arduino', () => {
    const img = parseIntelHex(loadFixtureText('avr-blink.hex'))
    expect(img.baseAddress).toBe(0)
    expect(img.data[0]).toBe(0x0c) // таблица векторов: jmp
    expect(img.data.length).toBeGreaterThan(1000)
    expect(img.data.length).toBeLessThan(0x7e00)
  })
})

describe('formatIntelHex', () => {
  it('туда и обратно даёт те же байты, пропуская пустые записи', () => {
    const data = new Uint8Array(64).fill(0xff)
    for (let i = 0; i < 16; i++) data[i] = i + 1
    data.fill(0xab, 48)
    const text = formatIntelHex(data)
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(3) // две записи данных + конец файла
    const back = parseIntelHex(text)
    expect(back.baseAddress).toBe(0)
    expect(Array.from(back.data)).toEqual(Array.from(data))
  })

  it('пишет запись 04 при адресах выше 64 КБ', () => {
    const text = formatIntelHex(Uint8Array.of(0x55), 0x10000)
    expect(text.startsWith(':020000040001F9\r\n:0100000055AA\r\n')).toBe(true)
  })
})
```

`firmware-site/tests/analysis/strings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { extractStrings } from '@/analysis/strings'
import { parseIntelHex } from '@/analysis/intelHex'
import { loadFixtureText } from '../helpers/fixtures'

describe('extractStrings', () => {
  it('находит ASCII и кириллицу UTF-8 с адресами', () => {
    const enc = new TextEncoder()
    const data = new Uint8Array([0, 1, ...enc.encode('Hello, мир!'), 0, ...enc.encode('ab'), 0])
    expect(extractStrings(data, 0x100)).toEqual([{ address: 0x102, text: 'Hello, мир!' }])
  })

  it('соблюдает минимальную длину и предел количества', () => {
    const data = new TextEncoder().encode('abcde\0fghij\0klmno')
    expect(extractStrings(data, 0, 5, 2).map((s) => s.text)).toEqual(['abcde', 'fghij'])
    expect(extractStrings(data, 0, 6)).toEqual([])
  })

  it('находит строку из прошивки Arduino', () => {
    const img = parseIntelHex(loadFixtureText('avr-blink.hex'))
    expect(extractStrings(img.data).map((s) => s.text)).toContain('Privet ot Paulukevichusa')
  })
})
```

- [ ] **Step 4: Запустить — тесты падают**

Run: `npm test -- tests/analysis/intelHex.test.ts tests/analysis/strings.test.ts`
Expected: FAIL — `Failed to resolve import "@/analysis/intelHex"`.

- [ ] **Step 5: Реализовать Intel HEX**

`firmware-site/src/analysis/intelHex.ts`:

```ts
/** Intel HEX — формат, в котором Arduino IDE и avrdude сохраняют прошивки. */

export interface HexImage {
  data: Uint8Array
  baseAddress: number
}

const MAX_IMAGE = 64 * 1024 * 1024

export function parseIntelHex(text: string): HexImage {
  const chunks: { addr: number; bytes: Uint8Array }[] = []
  let upper = 0
  const lines = text.split(/\r?\n/)
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim()
    if (!line) continue
    const where = `Строка ${n + 1}`
    if (line[0] !== ':' || line.length < 11 || (line.length - 1) % 2 !== 0 || !/^:[0-9A-Fa-f]+$/.test(line)) {
      throw new Error(`${where}: это не Intel HEX`)
    }
    const raw = new Uint8Array((line.length - 1) / 2)
    for (let i = 0; i < raw.length; i++) raw[i] = parseInt(line.substr(1 + i * 2, 2), 16)
    const len = raw[0]
    if (raw.length !== len + 5) throw new Error(`${where}: неверная длина записи`)
    let sum = 0
    for (const b of raw) sum = (sum + b) & 0xff
    if (sum !== 0) throw new Error(`${where}: неверная контрольная сумма`)
    const addr = (raw[1] << 8) | raw[2]
    const type = raw[3]
    const payload = raw.subarray(4, 4 + len)
    if (type === 0x00) chunks.push({ addr: upper + addr, bytes: payload.slice() })
    else if (type === 0x01) break
    else if (type === 0x02) upper = ((payload[0] << 8) | payload[1]) * 16
    else if (type === 0x04) upper = ((payload[0] << 8) | payload[1]) * 0x10000
    // 0x03 и 0x05 — адрес запуска, для заливки не нужен
  }
  if (!chunks.length) throw new Error('В файле нет данных')
  let base = Infinity
  let end = 0
  for (const c of chunks) {
    base = Math.min(base, c.addr)
    end = Math.max(end, c.addr + c.bytes.length)
  }
  if (end - base > MAX_IMAGE) throw new Error('Слишком большой диапазон адресов в HEX-файле')
  const data = new Uint8Array(end - base).fill(0xff)
  for (const c of chunks) data.set(c.bytes, c.addr - base)
  return { data, baseAddress: base }
}

function record(type: number, addr: number, bytes: ArrayLike<number>): string {
  const raw = [bytes.length, (addr >> 8) & 0xff, addr & 0xff, type, ...Array.from(bytes)]
  const sum = raw.reduce((a, b) => a + b, 0)
  raw.push((0x100 - (sum & 0xff)) & 0xff)
  return ':' + raw.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('')
}

/** Записи из одних 0xFF пропускаются — это стёртая flash, при разборе они восстанавливаются. */
export function formatIntelHex(data: Uint8Array, baseAddress = 0): string {
  const lines: string[] = []
  let upper = 0
  for (let off = 0; off < data.length; off += 16) {
    const chunk = data.subarray(off, Math.min(off + 16, data.length))
    if (chunk.every((b) => b === 0xff)) continue
    const addr = baseAddress + off
    const hi = Math.floor(addr / 0x10000)
    if (hi !== upper) {
      lines.push(record(0x04, 0, [hi >> 8, hi & 0xff]))
      upper = hi
    }
    lines.push(record(0x00, addr & 0xffff, chunk))
  }
  lines.push(record(0x01, 0, []))
  return lines.join('\r\n') + '\r\n'
}
```

- [ ] **Step 6: Реализовать поиск строк**

`firmware-site/src/analysis/strings.ts`:

```ts
export interface FoundString {
  address: number
  text: string
}

/** Длина печатного символа в байтах (ASCII или UTF-8 до 3 байт) или 0, если это не текст. */
function charLength(b: Uint8Array, i: number): number {
  const c = b[i]
  if (c === undefined) return 0
  if ((c >= 0x20 && c < 0x7f) || c === 0x09) return 1
  const cont = (k: number) => i + k < b.length && (b[i + k] & 0xc0) === 0x80
  if (c >= 0xc2 && c <= 0xdf && cont(1)) return 2
  if (c >= 0xe0 && c <= 0xef && cont(1) && cont(2)) return 3
  return 0
}

export function extractStrings(data: Uint8Array, baseAddress = 0, minLength = 5, limit = 100_000): FoundString[] {
  const out: FoundString[] = []
  const decoder = new TextDecoder()
  let i = 0
  while (i < data.length && out.length < limit) {
    const start = i
    let chars = 0
    for (let n = charLength(data, i); n > 0; n = charLength(data, i)) {
      i += n
      chars++
    }
    if (chars >= minLength) out.push({ address: baseAddress + start, text: decoder.decode(data.subarray(start, i)) })
    if (i === start) i++
  }
  return out
}
```

- [ ] **Step 7: Запустить — тесты проходят**

Run: `npm test -- tests/analysis`
Expected: PASS (все тесты Task 1 и Task 2).

- [ ] **Step 8: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: разбор Intel HEX и поиск строк в прошивке"
```

---

### Task 3: Форматы ESP32 — образ, паспорт, разделы, otadata

**Files:**
- Create: `firmware-site/tools/fixtures/esp32-hello/platformio.ini`, `…/CMakeLists.txt`, `…/partitions.csv`, `…/src/CMakeLists.txt`, `…/src/main.c`
- Create: `firmware-site/tools/fixtures/make_otadata.py`
- Create: `firmware-site/tests/fixtures/esp32-bootloader.bin`, `esp32-partitions.bin`, `esp32-app.bin`, `esp32-otadata-slot1.bin`
- Create: `firmware-site/tests/helpers/espFlash.ts`
- Create: `firmware-site/src/analysis/espImage.ts`, `firmware-site/src/analysis/appDesc.ts`, `firmware-site/src/analysis/partitions.ts`, `firmware-site/src/analysis/otadata.ts`
- Test: `firmware-site/tests/analysis/esp.test.ts`

**Interfaces:**
- Consumes: `u16le`, `u32le`, `cString` из Task 1; `loadFixture` из Task 2.
- Produces:
  - `ESP_IMAGE_MAGIC = 0xe9`, `ESP_CHIP_NAMES: Record<number, string>`
  - `interface EspSegment { loadAddress: number; length: number; dataOffset: number }`
  - `interface EspImage { chipId: number; chipName: string | null; flashSizeBytes: number | null; entry: number; hashAppended: boolean; segments: EspSegment[]; length: number }`
  - `parseEspImage(b: Uint8Array, offset?: number): EspImage | null`
  - `espImageLengthFromHeaders(header: Uint8Array, segmentLengths: number[]): number` — длина образа по заголовку и длинам сегментов (используется драйвером)
  - `bootloaderOffset(chip: string): number`
  - `looksEncrypted(data: Uint8Array, baseAddress: number, chip: string): boolean | null`
  - `APP_DESC_MAGIC = 0xabcd5432`, `interface AppDesc { version: string; projectName: string; time: string; date: string; idfVersion: string; secureVersion: number }`, `parseAppDesc(b: Uint8Array, imageOffset?: number): AppDesc | null`
  - `PARTITION_TABLE_OFFSET = 0x8000`, `PARTITION_TABLE_SIZE = 0xc00`
  - `interface Partition { label: string; type: number; subtype: number; typeName: string; subtypeName: string; offset: number; size: number; encrypted: boolean }`
  - `parsePartitionTable(b: Uint8Array): Partition[]`
  - `isAppPartition(p: Partition): boolean`, `isOtaDataPartition(p: Partition): boolean`
  - `crc32(data: Uint8Array, prev?: number): number`
  - `activeOtaSeq(otadata: Uint8Array): number | null`
  - `selectAppPartition(parts: Partition[], otadata: Uint8Array | null): Partition | null`
  - Тестовый помощник `buildEspFlash(opts?: { otadata?: Uint8Array; encrypted?: boolean }): Uint8Array` — 4 МБ flash ESP32

- [ ] **Step 1: Проект эталонной прошивки ESP32**

`firmware-site/tools/fixtures/esp32-hello/platformio.ini`:

```ini
; Эталонная прошивка ESP32 для тестов разбора образа, паспорта и таблицы разделов.
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = espidf
board_build.partitions = partitions.csv
```

`firmware-site/tools/fixtures/esp32-hello/CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.16.0)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
set(PROJECT_VER "1.2.3")
project(pauluk_fixture)
```

`firmware-site/tools/fixtures/esp32-hello/src/CMakeLists.txt`:

```cmake
FILE(GLOB_RECURSE app_sources ${CMAKE_SOURCE_DIR}/src/*.*)
idf_component_register(SRCS ${app_sources})
```

`firmware-site/tools/fixtures/esp32-hello/partitions.csv`:

```csv
# Name,   Type, SubType, Offset,   Size
nvs,      data, nvs,     0x9000,   0x4000
otadata,  data, ota,     0xd000,   0x2000
phy_init, data, phy,     0xf000,   0x1000
ota_0,    app,  ota_0,   0x10000,  0x180000
ota_1,    app,  ota_1,   0x190000, 0x180000
spiffs,   data, spiffs,  0x310000, 0xF0000
```

`firmware-site/tools/fixtures/esp32-hello/src/main.c`:

```c
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

void app_main(void) {
    while (1) {
        printf("Privet ot Paulukevichusa\n");
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
```

- [ ] **Step 2: Собрать и скопировать фикстуры**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику/firmware-site"
/c/Users/mpavl/.platformio/penv/Scripts/pio.exe run -d tools/fixtures/esp32-hello
B=tools/fixtures/esp32-hello/.pio/build/esp32dev
cp $B/bootloader.bin tests/fixtures/esp32-bootloader.bin
cp $B/partitions.bin tests/fixtures/esp32-partitions.bin
cp $B/firmware.bin tests/fixtures/esp32-app.bin
```

Expected: `SUCCESS` (первая сборка может скачивать пакеты несколько минут). Проверка паспорта:

```bash
grep -c "pauluk_fixture" tests/fixtures/esp32-app.bin
```

Expected: `1` или больше. Если PlatformIO подставил другое имя проекта, выполнить `strings tests/fixtures/esp32-app.bin | head -20`, найти имя рядом с `1.2.3` и использовать его в тесте Step 4 вместо `pauluk_fixture`.

- [ ] **Step 3: Сгенерировать otadata независимой реализацией CRC (Python zlib)**

`firmware-site/tools/fixtures/make_otadata.py`:

```python
"""otadata с активным слотом ota_1 — так, как её пишет ESP-IDF (otatool.py).
CRC считается через binascii (zlib), чтобы тест проверял нашу реализацию crc32 независимо."""
import binascii
import pathlib
import struct

OUT = pathlib.Path(__file__).resolve().parents[2] / 'tests' / 'fixtures' / 'esp32-otadata-slot1.bin'


def entry(seq: int) -> bytes:
    crc = binascii.crc32(struct.pack('<I', seq), 0xFFFFFFFF) & 0xFFFFFFFF
    return struct.pack('<I20sII', seq, b'\xff' * 20, 0xFFFFFFFF, crc)


blob = bytearray(b'\xff' * 0x2000)
blob[0:32] = entry(1)
blob[0x1000:0x1020] = entry(2)  # seq 2 → (2 - 1) % 2 = слот 1 (ota_1)
OUT.write_bytes(bytes(blob))
print('ok', OUT)
```

```bash
/c/Espressif/tools/python/python tools/fixtures/make_otadata.py
```

Expected: `ok …esp32-otadata-slot1.bin`.

- [ ] **Step 4: Помощник сборки полной flash и падающие тесты**

`firmware-site/tests/helpers/espFlash.ts`:

```ts
import { loadFixture } from './fixtures'

/** 4 МБ flash ESP32, как её отдал бы read_flash: загрузчик, таблица разделов, приложение в ota_0 и ota_1. */
export function buildEspFlash(opts: { otadata?: Uint8Array; encrypted?: boolean } = {}): Uint8Array {
  const flash = new Uint8Array(0x400000).fill(0xff)
  flash.set(loadFixture('esp32-bootloader.bin'), 0x1000)
  flash.set(loadFixture('esp32-partitions.bin'), 0x8000)
  const app = loadFixture('esp32-app.bin')
  flash.set(app, 0x10000)
  flash.set(app, 0x190000)
  if (opts.otadata) flash.set(opts.otadata, 0xd000)
  if (opts.encrypted) flash[0x1000] = 0x5a
  return flash
}
```

`firmware-site/tests/analysis/esp.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bootloaderOffset, looksEncrypted, parseEspImage } from '@/analysis/espImage'
import { parseAppDesc } from '@/analysis/appDesc'
import { parsePartitionTable, PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE } from '@/analysis/partitions'
import { activeOtaSeq, crc32, selectAppPartition } from '@/analysis/otadata'
import { loadFixture } from '../helpers/fixtures'
import { buildEspFlash } from '../helpers/espFlash'

const app = loadFixture('esp32-app.bin')
const parts = parsePartitionTable(loadFixture('esp32-partitions.bin'))
const otaSlot1 = loadFixture('esp32-otadata-slot1.bin')

describe('parseEspImage', () => {
  it('разбирает образ приложения и считает его точную длину', () => {
    const img = parseEspImage(app)!
    expect(img.chipName).toBe('ESP32')
    expect(img.segments.length).toBeGreaterThan(2)
    expect(img.length).toBe(app.length)
  })

  it('разбирает загрузчик внутри полной flash', () => {
    expect(parseEspImage(buildEspFlash(), 0x1000)?.chipName).toBe('ESP32')
  })

  it('возвращает null для не-образа и обрезанного образа', () => {
    expect(parseEspImage(new Uint8Array(64).fill(0xff))).toBeNull()
    expect(parseEspImage(app.subarray(0, 100))).toBeNull()
  })
})

describe('looksEncrypted', () => {
  it('различает обычную, зашифрованную и пустую flash', () => {
    expect(bootloaderOffset('ESP32')).toBe(0x1000)
    expect(bootloaderOffset('ESP32-S3')).toBe(0)
    expect(looksEncrypted(buildEspFlash(), 0, 'ESP32')).toBe(false)
    expect(looksEncrypted(buildEspFlash({ encrypted: true }), 0, 'ESP32')).toBe(true)
    expect(looksEncrypted(new Uint8Array(0x2000).fill(0xff), 0, 'ESP32')).toBe(false)
    expect(looksEncrypted(app, 0x10000, 'ESP32')).toBeNull() // дамп не содержит загрузчик
  })
})

describe('parseAppDesc', () => {
  it('читает паспорт приложения', () => {
    const desc = parseAppDesc(app)!
    expect(desc.version).toBe('1.2.3')
    expect(desc.projectName).toBe('pauluk_fixture')
    expect(desc.idfVersion).toMatch(/^v?\d/)
    expect(desc.date).toMatch(/\d{4}/)
  })

  it('null, если паспорта нет', () => {
    expect(parseAppDesc(new Uint8Array(512))).toBeNull()
  })
})

describe('parsePartitionTable', () => {
  it('читает разделы из таблицы, собранной ESP-IDF', () => {
    expect(parts.map((p) => p.label)).toEqual(['nvs', 'otadata', 'phy_init', 'ota_0', 'ota_1', 'spiffs'])
    const ota1 = parts[4]
    expect(ota1).toMatchObject({ typeName: 'app', subtypeName: 'ota_1', offset: 0x190000, size: 0x180000, encrypted: false })
    expect(parts[5].subtypeName).toBe('spiffs')
    expect(PARTITION_TABLE_OFFSET).toBe(0x8000)
    expect(PARTITION_TABLE_SIZE).toBe(0xc00)
  })

  it('пустая flash — пустой список', () => {
    expect(parsePartitionTable(new Uint8Array(0xc00).fill(0xff))).toEqual([])
  })
})

describe('otadata', () => {
  it('crc32 совпадает со стандартным', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('находит активную запись с максимальным seq и верным CRC', () => {
    expect(activeOtaSeq(otaSlot1)).toBe(2)
    expect(activeOtaSeq(new Uint8Array(0x2000).fill(0xff))).toBeNull()
    const broken = otaSlot1.slice()
    broken[0x1000 + 28] ^= 0xff // порченый CRC второй записи
    expect(activeOtaSeq(broken)).toBe(1)
  })

  it('выбирает раздел приложения, который загрузится', () => {
    expect(selectAppPartition(parts, otaSlot1)?.label).toBe('ota_1')
    expect(selectAppPartition(parts, new Uint8Array(0x2000).fill(0xff))?.label).toBe('ota_0')
    expect(selectAppPartition(parts, null)?.label).toBe('ota_0')
    const factory = [{ ...parts[3], label: 'factory', subtype: 0, subtypeName: 'factory' }]
    expect(selectAppPartition(factory, null)?.label).toBe('factory')
    expect(selectAppPartition([], null)).toBeNull()
  })
})
```

- [ ] **Step 5: Запустить — тесты падают**

Run: `npm test -- tests/analysis/esp.test.ts`
Expected: FAIL — `Failed to resolve import "@/analysis/espImage"`.

- [ ] **Step 6: Реализовать образ ESP**

`firmware-site/src/analysis/espImage.ts`:

```ts
import { u16le, u32le } from './bytes'

/** Формат образа ESP-IDF: заголовок 24 байта, сегменты «адрес+длина+данные», контрольная сумма, SHA-256. */
export const ESP_IMAGE_MAGIC = 0xe9

export const ESP_CHIP_NAMES: Record<number, string> = {
  0: 'ESP32',
  2: 'ESP32-S2',
  5: 'ESP32-C3',
  9: 'ESP32-S3',
  12: 'ESP32-C2',
  13: 'ESP32-C6',
  16: 'ESP32-H2',
  18: 'ESP32-P4',
}

const MB = 1024 * 1024
const FLASH_SIZES_MB = [1, 2, 4, 8, 16, 32, 64, 128]
const HEADER_SIZE = 24
const SEGMENT_HEADER_SIZE = 8
const MAX_SEGMENTS = 16

export interface EspSegment {
  loadAddress: number
  length: number
  dataOffset: number
}

export interface EspImage {
  chipId: number
  chipName: string | null
  flashSizeBytes: number | null
  entry: number
  hashAppended: boolean
  segments: EspSegment[]
  length: number
}

/**
 * Длина образа по заголовку (24 байта) и длинам сегментов: после сегментов — выравнивание,
 * байт контрольной суммы в конце 16-байтного блока и, если hash_appended, 32 байта SHA-256.
 */
export function espImageLengthFromHeaders(header: Uint8Array, segmentLengths: number[]): number {
  let pos = HEADER_SIZE
  for (const len of segmentLengths) pos += SEGMENT_HEADER_SIZE + len
  pos += 16 - (pos % 16)
  if (header[23] === 1) pos += 32
  return pos
}

export function parseEspImage(b: Uint8Array, offset = 0): EspImage | null {
  if (b.length < offset + HEADER_SIZE || b[offset] !== ESP_IMAGE_MAGIC) return null
  const count = b[offset + 1]
  if (count === 0 || count > MAX_SEGMENTS) return null
  const segments: EspSegment[] = []
  let pos = offset + HEADER_SIZE
  for (let i = 0; i < count; i++) {
    if (pos + SEGMENT_HEADER_SIZE > b.length) return null
    const length = u32le(b, pos + 4)
    if (pos + SEGMENT_HEADER_SIZE + length > b.length) return null
    segments.push({ loadAddress: u32le(b, pos), length, dataOffset: pos + SEGMENT_HEADER_SIZE })
    pos += SEGMENT_HEADER_SIZE + length
  }
  const header = b.subarray(offset, offset + HEADER_SIZE)
  const length = espImageLengthFromHeaders(header, segments.map((s) => s.length))
  if (offset + length > b.length) return null
  const chipId = u16le(b, offset + 12)
  const sizeCode = b[offset + 3] >> 4
  return {
    chipId,
    chipName: ESP_CHIP_NAMES[chipId] ?? null,
    flashSizeBytes: sizeCode < FLASH_SIZES_MB.length ? FLASH_SIZES_MB[sizeCode] * MB : null,
    entry: u32le(b, offset + 4),
    hashAppended: b[offset + 23] === 1,
    segments,
    length,
  }
}

export function bootloaderOffset(chip: string): number {
  return chip === 'ESP32' || chip === 'ESP32-S2' ? 0x1000 : 0
}

/**
 * true — на месте загрузчика нет 0xE9 (похоже на шифрование flash); false — загрузчик
 * открытый или flash пустая; null — дамп не содержит адрес загрузчика.
 */
export function looksEncrypted(data: Uint8Array, baseAddress: number, chip: string): boolean | null {
  const off = bootloaderOffset(chip) - baseAddress
  if (off < 0 || off >= data.length) return null
  const b = data[off]
  return b !== ESP_IMAGE_MAGIC && b !== 0xff
}
```

- [ ] **Step 7: Реализовать паспорт приложения**

`firmware-site/src/analysis/appDesc.ts`:

```ts
import { cString, u32le } from './bytes'

/** esp_app_desc_t — «паспорт», который ESP-IDF и Arduino-core зашивают в начало приложения. */
export const APP_DESC_MAGIC = 0xabcd5432
const APP_DESC_OFFSET = 0x20 // заголовок образа 24 байта + заголовок первого сегмента 8 байт
const APP_DESC_SIZE = 256

export interface AppDesc {
  version: string
  projectName: string
  time: string
  date: string
  idfVersion: string
  secureVersion: number
}

export function parseAppDesc(b: Uint8Array, imageOffset = 0): AppDesc | null {
  const o = imageOffset + APP_DESC_OFFSET
  if (o < 0 || b.length < o + APP_DESC_SIZE || u32le(b, o) !== APP_DESC_MAGIC) return null
  return {
    secureVersion: u32le(b, o + 4),
    version: cString(b, o + 16, 32),
    projectName: cString(b, o + 48, 32),
    time: cString(b, o + 80, 16),
    date: cString(b, o + 96, 16),
    idfVersion: cString(b, o + 112, 32),
  }
}
```

- [ ] **Step 8: Реализовать таблицу разделов**

`firmware-site/src/analysis/partitions.ts`:

```ts
import { cString, u32le } from './bytes'

export const PARTITION_TABLE_OFFSET = 0x8000
export const PARTITION_TABLE_SIZE = 0xc00
const ENTRY_SIZE = 32

export interface Partition {
  label: string
  type: number
  subtype: number
  typeName: string
  subtypeName: string
  offset: number
  size: number
  encrypted: boolean
}

const DATA_SUBTYPES: Record<number, string> = {
  0x00: 'ota',
  0x01: 'phy',
  0x02: 'nvs',
  0x03: 'coredump',
  0x04: 'nvs_keys',
  0x05: 'efuse',
  0x80: 'esphttpd',
  0x81: 'fat',
  0x82: 'spiffs',
  0x83: 'littlefs',
}

function subtypeName(type: number, subtype: number): string {
  if (type === 0) {
    if (subtype === 0x00) return 'factory'
    if (subtype >= 0x10 && subtype <= 0x1f) return `ota_${subtype - 0x10}`
    if (subtype === 0x20) return 'test'
  }
  if (type === 1 && DATA_SUBTYPES[subtype]) return DATA_SUBTYPES[subtype]
  return `0x${subtype.toString(16).padStart(2, '0')}`
}

/** b — байты, начиная с адреса таблицы. Записи идут до MD5-записи (0xEBEB) или пустоты (0xFFFF). */
export function parsePartitionTable(b: Uint8Array): Partition[] {
  const out: Partition[] = []
  for (let o = 0; o + ENTRY_SIZE <= b.length; o += ENTRY_SIZE) {
    if (b[o] !== 0xaa || b[o + 1] !== 0x50) break
    const type = b[o + 2]
    const subtype = b[o + 3]
    out.push({
      label: cString(b, o + 12, 16),
      type,
      subtype,
      typeName: type === 0 ? 'app' : type === 1 ? 'data' : `0x${type.toString(16)}`,
      subtypeName: subtypeName(type, subtype),
      offset: u32le(b, o + 4),
      size: u32le(b, o + 8),
      encrypted: (u32le(b, o + 28) & 1) === 1,
    })
  }
  return out
}

export function isAppPartition(p: Partition): boolean {
  return p.type === 0
}

export function isOtaDataPartition(p: Partition): boolean {
  return p.type === 1 && p.subtype === 0x00
}
```

- [ ] **Step 9: Реализовать otadata**

`firmware-site/src/analysis/otadata.ts`:

```ts
import { u32le } from './bytes'
import type { Partition } from './partitions'

/** CRC-32 (zlib). prev — предыдущее значение, как в binascii.crc32(data, prev) и esp_rom_crc32_le. */
export function crc32(data: Uint8Array, prev = 0): number {
  let crc = ~prev >>> 0
  for (const byte of data) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return ~crc >>> 0
}

const OTA_IMG_INVALID = 3
const OTA_IMG_ABORTED = 4

/** Две копии esp_ota_select_entry_t (по сектору): seq, label[20], state, crc. Побеждает больший seq. */
export function activeOtaSeq(otadata: Uint8Array): number | null {
  let best: number | null = null
  for (const off of [0, 0x1000]) {
    if (off + 32 > otadata.length) continue
    const seq = u32le(otadata, off)
    if (seq === 0xffffffff || seq === 0) continue
    const state = u32le(otadata, off + 24)
    if (state === OTA_IMG_INVALID || state === OTA_IMG_ABORTED) continue
    if (crc32(otadata.subarray(off, off + 4), 0xffffffff) !== u32le(otadata, off + 28)) continue
    if (best === null || seq > best) best = seq
  }
  return best
}

/** Раздел, который загрузит загрузчик ESP-IDF: по otadata, иначе factory, иначе ota_0. */
export function selectAppPartition(parts: Partition[], otadata: Uint8Array | null): Partition | null {
  const ota = parts
    .filter((p) => p.type === 0 && p.subtype >= 0x10 && p.subtype <= 0x1f)
    .sort((a, b) => a.subtype - b.subtype)
  const factory = parts.find((p) => p.type === 0 && p.subtype === 0x00) ?? null
  const seq = otadata && ota.length ? activeOtaSeq(otadata) : null
  if (seq !== null) return ota[(seq - 1) % ota.length]
  return factory ?? ota[0] ?? null
}
```

- [ ] **Step 10: Запустить — тесты проходят**

Run: `npm test -- tests/analysis`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: разбор образа ESP32, паспорта, разделов и otadata"
```

---

### Task 4: Транспорт Web Serial, контракт драйвера, имя порта

**Files:**
- Create: `firmware-site/src/serial/transport.ts`
- Create: `firmware-site/src/serial/webSerialTransport.ts`
- Create: `firmware-site/src/serial/portName.ts`
- Create: `firmware-site/src/drivers/types.ts`
- Create: `firmware-site/src/drivers/errors.ts`
- Test: `firmware-site/tests/serial/webSerialTransport.test.ts`, `firmware-site/tests/serial/portName.test.ts`

**Interfaces:**
- Consumes: `concatBytes`, `hexAddr` (Task 1); `Partition` (Task 3); `AppDesc` (Task 3).
- Produces:
  - `interface ByteTransport { open(baud: number): Promise<void>; close(): Promise<void>; write(data: Uint8Array): Promise<void>; read(n: number, timeoutMs: number): Promise<Uint8Array>; drain(quietMs?: number): Promise<void>; setSignals(s: { dtr?: boolean; rts?: boolean }): Promise<void> }`
  - `class SerialTimeoutError extends Error` (name `'SerialTimeoutError'`), `sleep(ms: number): Promise<void>`
  - `class WebSerialTransport implements ByteTransport` — `constructor(port: SerialPort)`
  - `describePort(info: Partial<SerialPortInfo>): string`
  - Типы драйверов: `Family`, `AvrBootloader`, `BoardInfo`, `ReadTarget`, `ReadResult`, `Progress`, `AppInfo`, `BoardDriver` (код ниже)
  - Ошибки: `BoardNotFoundError(attempts: string[])`, `UnsupportedChipError(detail: string)`, `VerifyError(address: number)`, `DeviceLostError()`

- [ ] **Step 1: Контракт драйвера и ошибки (без логики — тесты в следующих задачах)**

`firmware-site/src/drivers/types.ts`:

```ts
import type { AppDesc } from '@/analysis/appDesc'
import type { Partition } from '@/analysis/partitions'

export type Family = 'avr' | 'esp32'
export type AvrBootloader = 'optiboot' | 'atmegaboot' | 'unknown'

export interface BoardInfo {
  family: Family
  chip: string // 'ATmega328P', 'ESP32-S3'
  revision?: string // полное описание от esptool, например «ESP32-D0WD-V3 (revision v3.1)»
  flashSize: number // байт
  mac?: string
  bootloader?: AvrBootloader
  baud: number
}

export type ReadTarget =
  | { kind: 'full' }
  | { kind: 'app' } // только ESP32
  | { kind: 'partition'; label: string } // только ESP32

export interface ReadResult {
  data: Uint8Array
  baseAddress: number // адрес начала data во flash
  eeprom?: Uint8Array // только AVR, если загрузчик позволил
  notes: string[]
  partitionLabel?: string
}

export type Progress = (done: number, total: number) => void

export interface AppInfo {
  partition: Partition
  desc: AppDesc | null
}

export interface BoardDriver {
  readonly info: BoardInfo
  read(target: ReadTarget, onProgress: Progress, signal: AbortSignal): Promise<ReadResult>
  write(data: Uint8Array, address: number, onProgress: Progress, signal: AbortSignal): Promise<void>
  readPartitionTable?(): Promise<Partition[]>
  activeAppPartition?(): Promise<Partition | null>
  appInfo?(): Promise<AppInfo | null>
  disconnect(): Promise<void>
}
```

`firmware-site/src/drivers/errors.ts`:

```ts
import { hexAddr } from '@/analysis/bytes'

export class BoardNotFoundError extends Error {
  constructor(readonly attempts: string[]) {
    super('Плата не отвечает')
    this.name = 'BoardNotFoundError'
  }
}

export class UnsupportedChipError extends Error {
  constructor(detail: string) {
    super(`Чип не поддерживается: ${detail}`)
    this.name = 'UnsupportedChipError'
  }
}

export class VerifyError extends Error {
  constructor(readonly address: number) {
    super(`Проверка после записи не прошла: данные по адресу ${hexAddr(address)} отличаются`)
    this.name = 'VerifyError'
  }
}

export class DeviceLostError extends Error {
  constructor() {
    super('Кабель отключён')
    this.name = 'DeviceLostError'
  }
}
```

`firmware-site/src/serial/transport.ts`:

```ts
/** Байтовый канал к плате. Реализации: WebSerialTransport (браузер) и эмулятор загрузчика в тестах. */
export interface ByteTransport {
  open(baud: number): Promise<void>
  close(): Promise<void>
  write(data: Uint8Array): Promise<void>
  /** Ровно n байт или SerialTimeoutError. */
  read(n: number, timeoutMs: number): Promise<Uint8Array>
  /** Выбросить всё, что уже пришло, и то, что придёт за quietMs. */
  drain(quietMs?: number): Promise<void>
  setSignals(s: { dtr?: boolean; rts?: boolean }): Promise<void>
}

export class SerialTimeoutError extends Error {
  constructor(expected: number, got: number) {
    super(`Плата не ответила вовремя: ждали ${expected} байт, пришло ${got}`)
    this.name = 'SerialTimeoutError'
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
```

- [ ] **Step 2: Падающие тесты транспорта и имени порта**

`firmware-site/tests/serial/webSerialTransport.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { WebSerialTransport } from '@/serial/webSerialTransport'
import { SerialTimeoutError } from '@/serial/transport'

/** Поддельный SerialPort на web streams Node 20. */
function fakePort() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const written: number[] = []
  const signals: SerialOutputSignals[] = []
  const opened: number[] = []
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    async open(o: SerialOptions) {
      opened.push(o.baudRate)
      port.readable = new ReadableStream<Uint8Array>({ start: (c) => { controller = c } })
      port.writable = new WritableStream<Uint8Array>({ write: (chunk) => { written.push(...chunk) } })
    },
    async close() {
      port.readable = null
      port.writable = null
    },
    async setSignals(s: SerialOutputSignals) {
      signals.push(s)
    },
    getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
  }
  return {
    port: port as unknown as SerialPort,
    push: (...b: number[]) => controller.enqueue(Uint8Array.from(b)),
    fail: (e: Error) => controller.error(e),
    written,
    signals,
    opened,
  }
}

describe('WebSerialTransport', () => {
  it('собирает ровно n байт из нескольких кусков', async () => {
    const f = fakePort()
    const t = new WebSerialTransport(f.port)
    await t.open(115200)
    f.push(0x14)
    setTimeout(() => f.push(0x10, 0x99), 10)
    expect(Array.from(await t.read(2, 500))).toEqual([0x14, 0x10])
    expect(Array.from(await t.read(1, 500))).toEqual([0x99])
    expect(f.opened).toEqual([115200])
    await t.close()
  })

  it('бросает SerialTimeoutError, если данных нет', async () => {
    const f = fakePort()
    const t = new WebSerialTransport(f.port)
    await t.open(57600)
    await expect(t.read(1, 30)).rejects.toBeInstanceOf(SerialTimeoutError)
    await t.close()
  })

  it('пишет байты и выставляет DTR/RTS', async () => {
    const f = fakePort()
    const t = new WebSerialTransport(f.port)
    await t.open(115200)
    await t.write(Uint8Array.of(0x30, 0x20))
    await t.setSignals({ dtr: false, rts: false })
    await t.setSignals({ dtr: true })
    expect(f.written).toEqual([0x30, 0x20])
    expect(f.signals).toEqual([{ dataTerminalReady: false, requestToSend: false }, { dataTerminalReady: true }])
    await t.close()
  })

  it('drain выбрасывает накопленный мусор', async () => {
    const f = fakePort()
    const t = new WebSerialTransport(f.port)
    await t.open(115200)
    f.push(1, 2, 3)
    await t.drain(10)
    f.push(4)
    expect(Array.from(await t.read(1, 100))).toEqual([4])
    await t.close()
  })

  it('ошибка порта (кабель выдернули) доходит до read', async () => {
    const f = fakePort()
    const t = new WebSerialTransport(f.port)
    await t.open(115200)
    const pending = t.read(1, 1000)
    f.fail(new DOMException('The device has been lost.', 'NetworkError'))
    await expect(pending).rejects.toMatchObject({ name: 'NetworkError' })
    await t.close()
  })

  it('после close можно открыть снова на другой скорости', async () => {
    const f = fakePort()
    const t = new WebSerialTransport(f.port)
    await t.open(115200)
    await t.close()
    await t.open(57600)
    f.push(7)
    expect(Array.from(await t.read(1, 100))).toEqual([7])
    expect(f.opened).toEqual([115200, 57600])
    await t.close()
  })
})
```

`firmware-site/tests/serial/portName.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { describePort } from '@/serial/portName'

describe('describePort', () => {
  it('узнаёт распространённые USB-адаптеры', () => {
    expect(describePort({ usbVendorId: 0x1a86, usbProductId: 0x7523 })).toBe('CH340 · USB 1A86:7523')
    expect(describePort({ usbVendorId: 0x10c4, usbProductId: 0xea60 })).toBe('CP2102 · USB 10C4:EA60')
    expect(describePort({ usbVendorId: 0x2341, usbProductId: 0x0043 })).toBe('Arduino Uno · USB 2341:0043')
    expect(describePort({ usbVendorId: 0x303a, usbProductId: 0x1001 })).toBe('ESP32 USB · USB 303A:1001')
  })

  it('неизвестный адаптер и порт без USB', () => {
    expect(describePort({ usbVendorId: 0x1234, usbProductId: 0x5678 })).toBe('USB-адаптер · USB 1234:5678')
    expect(describePort({})).toBe('Последовательный порт')
  })
})
```

- [ ] **Step 3: Запустить — тесты падают**

Run: `npm test -- tests/serial`
Expected: FAIL — `Failed to resolve import "@/serial/webSerialTransport"`.

- [ ] **Step 4: Реализовать транспорт**

`firmware-site/src/serial/webSerialTransport.ts`:

```ts
import { concatBytes } from '@/analysis/bytes'
import { type ByteTransport, SerialTimeoutError, sleep } from './transport'

export class WebSerialTransport implements ByteTransport {
  private buf = new Uint8Array(0)
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private loop: Promise<void> | null = null
  private failure: unknown = null
  private wake: (() => void) | null = null

  constructor(readonly port: SerialPort) {}

  async open(baud: number): Promise<void> {
    await this.port.open({ baudRate: baud, bufferSize: 64 * 1024 })
    this.buf = new Uint8Array(0)
    this.failure = null
    const readable = this.port.readable
    if (!readable) throw new Error('Порт открыт, но чтение из него недоступно')
    this.reader = readable.getReader()
    this.loop = this.readLoop(this.reader)
  }

  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value?.length) {
          this.buf = concatBytes(this.buf, value)
          this.wake?.()
        }
      }
    } catch (e) {
      this.failure = e
      this.wake?.()
    } finally {
      reader.releaseLock()
    }
  }

  async read(n: number, timeoutMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs
    while (this.buf.length < n) {
      if (this.failure) throw this.failure
      const left = deadline - Date.now()
      if (left <= 0) throw new SerialTimeoutError(n, this.buf.length)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left)
        this.wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
      this.wake = null
    }
    const out = this.buf.slice(0, n)
    this.buf = this.buf.slice(n)
    return out
  }

  async drain(quietMs = 50): Promise<void> {
    this.buf = new Uint8Array(0)
    await sleep(quietMs)
    this.buf = new Uint8Array(0)
  }

  async write(data: Uint8Array): Promise<void> {
    const writable = this.port.writable
    if (!writable) throw new Error('Порт закрыт')
    const writer = writable.getWriter()
    try {
      await writer.write(data)
    } finally {
      writer.releaseLock()
    }
  }

  async setSignals(s: { dtr?: boolean; rts?: boolean }): Promise<void> {
    const signals: SerialOutputSignals = {}
    if (s.dtr !== undefined) signals.dataTerminalReady = s.dtr
    if (s.rts !== undefined) signals.requestToSend = s.rts
    await this.port.setSignals(signals)
  }

  async close(): Promise<void> {
    await this.reader?.cancel().catch(() => {})
    await this.loop
    this.reader = null
    this.loop = null
    this.buf = new Uint8Array(0)
    await this.port.close().catch(() => {})
  }
}
```

`firmware-site/src/serial/portName.ts`:

```ts
/**
 * Web Serial не сообщает сайту номер COM-порта (его видно только в окне выбора Chrome),
 * поэтому порт подписывается по USB-адаптеру.
 */
const KNOWN_ADAPTERS: Record<string, string> = {
  '1A86:7523': 'CH340',
  '1A86:7522': 'CH340K',
  '1A86:55D4': 'CH9102',
  '10C4:EA60': 'CP2102',
  '0403:6001': 'FTDI FT232R',
  '0403:6015': 'FTDI FT231X',
  '2341:0043': 'Arduino Uno',
  '2341:0001': 'Arduino Uno',
  '2341:0243': 'Arduino Uno',
  '2A03:0043': 'Arduino Uno',
  '303A:1001': 'ESP32 USB',
  '303A:0002': 'ESP32-S2 USB',
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')

export function describePort(info: Partial<SerialPortInfo>): string {
  if (info.usbVendorId === undefined) return 'Последовательный порт'
  const vid = hex4(info.usbVendorId)
  const pid = info.usbProductId === undefined ? '????' : hex4(info.usbProductId)
  return `${KNOWN_ADAPTERS[`${vid}:${pid}`] ?? 'USB-адаптер'} · USB ${vid}:${pid}`
}
```

- [ ] **Step 5: Запустить — тесты проходят**

Run: `npm test -- tests/serial`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: транспорт Web Serial и контракт драйвера платы"
```

---

### Task 5: Протокол STK500v1 и драйвер Arduino

**Files:**
- Create: `firmware-site/src/drivers/avr/stk500.ts`
- Create: `firmware-site/src/drivers/avr/avrDriver.ts`
- Create: `firmware-site/tests/helpers/stk500Emulator.ts`
- Test: `firmware-site/tests/drivers/avr.test.ts`

**Interfaces:**
- Consumes: `ByteTransport`, `SerialTimeoutError`, `sleep` (Task 4); `BoardDriver`, `BoardInfo`, `ReadTarget`, `ReadResult`, `Progress`, `AvrBootloader` (Task 4); `UnsupportedChipError`, `VerifyError` (Task 4); `hexBytes`, `sameBytes` (Task 1).
- Produces:
  - `STK` (коды команд), `class Stk500Error extends Error`
  - `class Stk500 { constructor(t: ByteTransport, timeoutMs?: number); sync(attempts?: number): Promise<void>; signature(): Promise<number[]>; getParameter(p: number): Promise<number>; enterProgMode(): Promise<void>; leaveProgMode(): Promise<void>; readPage(byteAddr: number, length: number, mem: 'F' | 'E'): Promise<Uint8Array>; writePage(byteAddr: number, data: Uint8Array, mem?: 'F' | 'E'): Promise<void> }`
  - `ATMEGA328P = { name, signature, flashSize: 0x8000, eepromSize: 0x400, pageSize: 128 }`
  - `appAreaEnd(kind: AvrBootloader): number` → `0x7E00` для optiboot, иначе `0x7800`
  - `connectAvr(t: ByteTransport, baud: number): Promise<AvrDriver>`
  - `class AvrDriver implements BoardDriver`
  - Тестовый `class Stk500Emulator implements ByteTransport` с полями `flash`, `eeprom`, `opened`, `pageWrites`

- [ ] **Step 1: Эмулятор загрузчика Arduino для тестов**

`firmware-site/tests/helpers/stk500Emulator.ts`:

```ts
import type { ByteTransport } from '@/serial/transport'
import { SerialTimeoutError } from '@/serial/transport'

interface EmulatorOptions {
  bootloader: 'optiboot' | 'atmegaboot'
  signature?: number[]
  corruptWrites?: boolean
}

/**
 * Программная Arduino с загрузчиком: отвечает по STK500v1 только на «своей» скорости
 * (Optiboot 115200, ATmegaBOOT 57600) и только после сброса по DTR. После LEAVE_PROGMODE
 * уходит в программу пользователя и молчит до следующего сброса — как настоящий Optiboot.
 */
export class Stk500Emulator implements ByteTransport {
  flash = new Uint8Array(0x8000).fill(0xff)
  eeprom = new Uint8Array(0x400).fill(0xff)
  opened: number | null = null
  pageWrites = 0
  private dtr = true
  private inBootloader = false
  private input: number[] = []
  private output: number[] = []
  private wordAddress = 0
  private readonly baud: number

  constructor(private readonly opts: EmulatorOptions) {
    this.baud = opts.bootloader === 'optiboot' ? 115200 : 57600
  }

  async open(baud: number) {
    this.opened = baud
    this.inBootloader = false
  }

  async close() {
    this.opened = null
    this.inBootloader = false
  }

  async setSignals(s: { dtr?: boolean; rts?: boolean }) {
    if (s.dtr === undefined) return
    if (s.dtr && !this.dtr) this.inBootloader = true // фронт DTR через конденсатор дёргает RESET
    this.dtr = s.dtr
  }

  async drain() {
    this.output = []
  }

  async write(data: Uint8Array) {
    if (this.opened !== this.baud || !this.inBootloader) return // на чужой скорости плата слышит мусор
    this.input.push(...data)
    this.process()
  }

  async read(n: number) {
    if (this.output.length < n) {
      const got = this.output.length
      this.output = []
      throw new SerialTimeoutError(n, got)
    }
    return Uint8Array.from(this.output.splice(0, n))
  }

  private commandLength(): number | null {
    const c = this.input[0]
    switch (c) {
      case 0x30: case 0x75: case 0x50: case 0x51: return 2
      case 0x41: return 3
      case 0x55: return 4
      case 0x74: return 5
      case 0x64: return this.input.length < 3 ? null : 5 + ((this.input[1] << 8) | this.input[2])
      default: return 1
    }
  }

  private process() {
    while (this.input.length) {
      const need = this.commandLength()
      if (need === null || this.input.length < need) return
      this.respond(this.input.splice(0, need))
    }
  }

  private param(p: number): number {
    if (this.opts.bootloader === 'optiboot') return p === 0x81 ? 8 : p === 0x82 ? 0 : 3
    return p === 0x80 ? 2 : p === 0x81 ? 1 : p === 0x82 ? 0x10 : 0
  }

  private respond(c: number[]) {
    if (c.length === 1) return // неизвестный байт — загрузчик его проглатывает
    if (c[c.length - 1] !== 0x20) {
      this.output.push(0x15) // STK_NOSYNC
      return
    }
    const ok = (...body: number[]) => this.output.push(0x14, ...body, 0x10)
    const byteAddress = this.wordAddress * 2
    switch (c[0]) {
      case 0x30: ok(); break
      case 0x75: ok(...(this.opts.signature ?? [0x1e, 0x95, 0x0f])); break
      case 0x41: ok(this.param(c[1])); break
      case 0x50: ok(); break
      case 0x51: ok(); this.inBootloader = false; break
      case 0x55: this.wordAddress = c[1] | (c[2] << 8); ok(); break
      case 0x74: {
        const len = (c[1] << 8) | c[2]
        const eeprom = c[3] === 0x45 && this.opts.bootloader === 'atmegaboot' // Optiboot вместо EEPROM отдаёт flash
        ok(...(eeprom ? this.eeprom : this.flash).subarray(byteAddress, byteAddress + len))
        break
      }
      case 0x64: {
        const len = (c[1] << 8) | c[2]
        const data = c.slice(4, 4 + len)
        if (this.opts.corruptWrites) data[0] ^= 0xff
        this.flash.set(data, byteAddress)
        this.pageWrites++
        ok()
        break
      }
    }
  }
}
```

- [ ] **Step 2: Падающие тесты драйвера**

`firmware-site/tests/drivers/avr.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ATMEGA328P, appAreaEnd, connectAvr } from '@/drivers/avr/avrDriver'
import { UnsupportedChipError, VerifyError } from '@/drivers/errors'
import { Stk500Emulator } from '../helpers/stk500Emulator'

function randomFlash(emu: Stk500Emulator) {
  for (let i = 0; i < emu.flash.length; i++) emu.flash[i] = (i * 31 + 7) & 0xff
}
const noop = () => {}
const live = () => new AbortController().signal

describe('connectAvr', () => {
  it('подключается к Optiboot на 115200', async () => {
    const emu = new Stk500Emulator({ bootloader: 'optiboot' })
    const d = await connectAvr(emu, 115200)
    expect(d.info).toMatchObject({ family: 'avr', chip: 'ATmega328P', flashSize: 0x8000, bootloader: 'optiboot', baud: 115200 })
    await d.disconnect()
    expect(emu.opened).toBeNull()
  })

  it('узнаёт старый загрузчик Nano на 57600', async () => {
    const d = await connectAvr(new Stk500Emulator({ bootloader: 'atmegaboot' }), 57600)
    expect(d.info.bootloader).toBe('atmegaboot')
  })

  it('на чужой скорости не подключается и закрывает порт', async () => {
    const emu = new Stk500Emulator({ bootloader: 'atmegaboot' })
    await expect(connectAvr(emu, 115200)).rejects.toThrow(/не отвечает/)
    expect(emu.opened).toBeNull()
  })

  it('чужой чип — UnsupportedChipError с сигнатурой', async () => {
    const emu = new Stk500Emulator({ bootloader: 'optiboot', signature: [0x1e, 0x98, 0x01] })
    await expect(connectAvr(emu, 115200)).rejects.toSatisfy(
      (e: unknown) => e instanceof UnsupportedChipError && /1E 98 01/.test((e as Error).message),
    )
  })
})

describe('AvrDriver.read', () => {
  it('читает всю flash и сообщает, что Optiboot не отдаёт EEPROM', async () => {
    const emu = new Stk500Emulator({ bootloader: 'optiboot' })
    randomFlash(emu)
    const d = await connectAvr(emu, 115200)
    const progress: number[] = []
    const r = await d.read({ kind: 'full' }, (done, total) => progress.push(done / total), live())
    expect(Array.from(r.data)).toEqual(Array.from(emu.flash))
    expect(r.baseAddress).toBe(0)
    expect(r.eeprom).toBeUndefined()
    expect(r.notes.join()).toMatch(/EEPROM/)
    expect(progress.at(-1)).toBe(1)
  })

  it('у старого загрузчика читает и EEPROM', async () => {
    const emu = new Stk500Emulator({ bootloader: 'atmegaboot' })
    emu.eeprom.fill(0x42, 0, 16)
    const d = await connectAvr(emu, 57600)
    const r = await d.read({ kind: 'full' }, noop, live())
    expect(Array.from(r.eeprom!)).toEqual(Array.from(emu.eeprom))
  })

  it('две операции подряд работают — плата каждый раз заново входит в загрузчик', async () => {
    const emu = new Stk500Emulator({ bootloader: 'optiboot' })
    const d = await connectAvr(emu, 115200)
    await d.read({ kind: 'full' }, noop, live())
    await expect(d.read({ kind: 'full' }, noop, live())).resolves.toBeTruthy()
  })

  it('останавливается по «Стоп»', async () => {
    const d = await connectAvr(new Stk500Emulator({ bootloader: 'optiboot' }), 115200)
    const ctl = new AbortController()
    ctl.abort()
    await expect(d.read({ kind: 'full' }, noop, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('для Arduino нет чтения «только приложения»', async () => {
    const d = await connectAvr(new Stk500Emulator({ bootloader: 'optiboot' }), 115200)
    await expect(d.read({ kind: 'app' }, noop, live())).rejects.toThrow(/только/)
  })
})

describe('AvrDriver.write', () => {
  it('пишет всю область приложения, не трогает загрузчик и стирает хвост старой прошивки', async () => {
    const emu = new Stk500Emulator({ bootloader: 'optiboot' })
    randomFlash(emu) // «старая» прошивка и загрузчик
    const bootloader = emu.flash.slice(appAreaEnd('optiboot'))
    const d = await connectAvr(emu, 115200)
    const image = new Uint8Array(0x8000).fill(0xff)
    image.fill(0x11, 0, 1000)
    image.fill(0x99, appAreaEnd('optiboot')) // «чужой» загрузчик в файле должен быть пропущен
    await d.write(image, 0, noop, live())
    expect(Array.from(emu.flash.subarray(0, 1000))).toEqual(new Array(1000).fill(0x11))
    expect(emu.flash.subarray(1000, appAreaEnd('optiboot')).every((b) => b === 0xff)).toBe(true)
    expect(Array.from(emu.flash.subarray(appAreaEnd('optiboot')))).toEqual(Array.from(bootloader))
    expect(emu.pageWrites).toBe(appAreaEnd('optiboot') / ATMEGA328P.pageSize)
  })

  it('короткий файл дополняется 0xFF', async () => {
    const emu = new Stk500Emulator({ bootloader: 'atmegaboot' })
    randomFlash(emu)
    const d = await connectAvr(emu, 57600)
    await d.write(Uint8Array.of(1, 2, 3), 0, noop, live())
    expect(Array.from(emu.flash.subarray(0, 4))).toEqual([1, 2, 3, 0xff])
    expect(appAreaEnd('atmegaboot')).toBe(0x7800)
    expect(appAreaEnd('unknown')).toBe(0x7800)
  })

  it('битая запись ловится проверкой', async () => {
    const d = await connectAvr(new Stk500Emulator({ bootloader: 'optiboot', corruptWrites: true }), 115200)
    await expect(d.write(new Uint8Array(256), 0, noop, live())).rejects.toBeInstanceOf(VerifyError)
  })

  it('адрес не с нуля — ошибка', async () => {
    const d = await connectAvr(new Stk500Emulator({ bootloader: 'optiboot' }), 115200)
    await expect(d.write(new Uint8Array(4), 0x100, noop, live())).rejects.toThrow(/адреса 0/)
  })
})
```

- [ ] **Step 3: Запустить — тесты падают**

Run: `npm test -- tests/drivers/avr.test.ts`
Expected: FAIL — `Failed to resolve import "@/drivers/avr/avrDriver"`.

- [ ] **Step 4: Реализовать STK500v1**

`firmware-site/src/drivers/avr/stk500.ts`:

```ts
import { hexBytes } from '@/analysis/bytes'
import { type ByteTransport, sleep } from '@/serial/transport'

/** Протокол загрузчиков Arduino (Optiboot, ATmegaBOOT) — подмножество STK500 v1. */
export const STK = {
  OK: 0x10,
  INSYNC: 0x14,
  CRC_EOP: 0x20,
  GET_SYNC: 0x30,
  GET_PARAMETER: 0x41,
  ENTER_PROGMODE: 0x50,
  LEAVE_PROGMODE: 0x51,
  LOAD_ADDRESS: 0x55,
  PROG_PAGE: 0x64,
  READ_PAGE: 0x74,
  READ_SIGN: 0x75,
} as const

export class Stk500Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Stk500Error'
  }
}

export class Stk500 {
  constructor(
    private readonly t: ByteTransport,
    private readonly timeoutMs = 500,
  ) {}

  private async command(bytes: ArrayLike<number>, responseLength = 0): Promise<Uint8Array> {
    const packet = new Uint8Array(bytes.length + 1)
    packet.set(Array.from(bytes))
    packet[bytes.length] = STK.CRC_EOP
    await this.t.write(packet)
    const head = await this.t.read(1, this.timeoutMs)
    if (head[0] !== STK.INSYNC) throw new Stk500Error(`Загрузчик ответил не по протоколу (${hexBytes(head)})`)
    const body = responseLength ? await this.t.read(responseLength, this.timeoutMs) : new Uint8Array(0)
    const tail = await this.t.read(1, this.timeoutMs)
    if (tail[0] !== STK.OK) throw new Stk500Error(`Загрузчик не подтвердил команду (${hexBytes(tail)})`)
    return body
  }

  async sync(attempts = 5): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      await this.t.drain(20)
      try {
        await this.command([STK.GET_SYNC])
        return
      } catch {
        await sleep(50)
      }
    }
    throw new Stk500Error('Загрузчик Arduino не отвечает')
  }

  async signature(): Promise<number[]> {
    return Array.from(await this.command([STK.READ_SIGN], 3))
  }

  async getParameter(p: number): Promise<number> {
    return (await this.command([STK.GET_PARAMETER, p], 1))[0]
  }

  async enterProgMode(): Promise<void> {
    await this.command([STK.ENTER_PROGMODE])
  }

  async leaveProgMode(): Promise<void> {
    await this.command([STK.LEAVE_PROGMODE])
  }

  /** Загрузчики Arduino принимают адрес в словах (2 байта) и для flash, и для EEPROM. */
  private async loadAddress(byteAddr: number): Promise<void> {
    const word = byteAddr >> 1
    await this.command([STK.LOAD_ADDRESS, word & 0xff, (word >> 8) & 0xff])
  }

  async readPage(byteAddr: number, length: number, mem: 'F' | 'E'): Promise<Uint8Array> {
    await this.loadAddress(byteAddr)
    return this.command([STK.READ_PAGE, length >> 8, length & 0xff, mem.charCodeAt(0)], length)
  }

  async writePage(byteAddr: number, data: Uint8Array, mem: 'F' | 'E' = 'F'): Promise<void> {
    await this.loadAddress(byteAddr)
    const packet = new Uint8Array(4 + data.length)
    packet.set([STK.PROG_PAGE, data.length >> 8, data.length & 0xff, mem.charCodeAt(0)])
    packet.set(data, 4)
    await this.command(packet)
  }
}
```

- [ ] **Step 5: Реализовать драйвер Arduino**

`firmware-site/src/drivers/avr/avrDriver.ts`:

```ts
import { hexBytes, sameBytes } from '@/analysis/bytes'
import { type ByteTransport, sleep } from '@/serial/transport'
import { UnsupportedChipError, VerifyError } from '../errors'
import type { AvrBootloader, BoardDriver, BoardInfo, Progress, ReadResult, ReadTarget } from '../types'
import { Stk500 } from './stk500'

export const ATMEGA328P = {
  name: 'ATmega328P',
  signature: [0x1e, 0x95, 0x0f],
  flashSize: 0x8000,
  eepromSize: 0x400,
  pageSize: 128,
} as const

/** Конец области приложения: Optiboot занимает 512 байт, старый ATmegaBOOT — 2 КБ. */
export function appAreaEnd(kind: AvrBootloader): number {
  return kind === 'optiboot' ? 0x7e00 : 0x7800
}

/** Импульс на DTR/RTS через конденсатор на плате дёргает RESET — плата уходит в загрузчик. */
async function resetBoard(t: ByteTransport): Promise<void> {
  await t.setSignals({ dtr: false, rts: false })
  await sleep(250)
  await t.setSignals({ dtr: true, rts: true })
  await sleep(50)
  await t.drain(20)
}

async function enterBootloader(t: ByteTransport, stk: Stk500): Promise<void> {
  await resetBoard(t)
  await stk.sync()
  await stk.enterProgMode()
}

export async function connectAvr(t: ByteTransport, baud: number): Promise<AvrDriver> {
  await t.open(baud)
  try {
    const stk = new Stk500(t)
    await enterBootloader(t, stk)
    const sig = await stk.signature()
    if (!sameBytes(sig, ATMEGA328P.signature)) throw new UnsupportedChipError(`сигнатура ${hexBytes(sig)}`)
    const major = await stk.getParameter(0x81).catch(() => null)
    const bootloader: AvrBootloader = major === null ? 'unknown' : major >= 4 ? 'optiboot' : 'atmegaboot'
    await stk.leaveProgMode().catch(() => {}) // плата продолжает работать, пока её не попросят
    return new AvrDriver(t, stk, {
      family: 'avr',
      chip: ATMEGA328P.name,
      flashSize: ATMEGA328P.flashSize,
      bootloader,
      baud,
    })
  } catch (e) {
    await t.close().catch(() => {})
    throw e
  }
}

export class AvrDriver implements BoardDriver {
  constructor(
    private readonly t: ByteTransport,
    private readonly stk: Stk500,
    readonly info: BoardInfo,
  ) {}

  /** Optiboot сам выходит из загрузчика через ~1 с простоя, поэтому каждая операция начинается со сброса. */
  private async session<T>(fn: () => Promise<T>): Promise<T> {
    await enterBootloader(this.t, this.stk)
    try {
      return await fn()
    } finally {
      await this.stk.leaveProgMode().catch(() => {})
    }
  }

  async read(target: ReadTarget, onProgress: Progress, signal: AbortSignal): Promise<ReadResult> {
    if (target.kind !== 'full') throw new Error('Для Arduino доступно только чтение всей flash')
    signal.throwIfAborted()
    return this.session(async () => {
      const { flashSize, pageSize, eepromSize } = ATMEGA328P
      const data = new Uint8Array(flashSize)
      for (let addr = 0; addr < flashSize; addr += pageSize) {
        signal.throwIfAborted()
        data.set(await this.stk.readPage(addr, pageSize, 'F'), addr)
        onProgress(addr + pageSize, flashSize)
      }
      const notes: string[] = []
      let eeprom: Uint8Array | undefined
      if (this.info.bootloader === 'atmegaboot') {
        eeprom = new Uint8Array(eepromSize)
        for (let addr = 0; addr < eepromSize; addr += pageSize) {
          signal.throwIfAborted()
          eeprom.set(await this.stk.readPage(addr, pageSize, 'E'), addr)
        }
      } else {
        notes.push('EEPROM не сохранена: загрузчик Optiboot её не читает')
      }
      return { data, baseAddress: 0, eeprom, notes }
    })
  }

  async write(data: Uint8Array, address: number, onProgress: Progress, signal: AbortSignal): Promise<void> {
    if (address !== 0) throw new Error('Прошивка Arduino должна начинаться с адреса 0')
    signal.throwIfAborted()
    const end = appAreaEnd(this.info.bootloader ?? 'unknown')
    const { pageSize } = ATMEGA328P
    // Пишем всю область приложения, включая пустые страницы: иначе на плате останутся
    // хвосты старой прошивки. Загрузчик сам себя не перезаписывает — его область пропускаем.
    const image = new Uint8Array(end).fill(0xff)
    image.set(data.subarray(0, Math.min(data.length, end)))
    const total = end * 2 // запись + проверка
    await this.session(async () => {
      for (let addr = 0; addr < end; addr += pageSize) {
        signal.throwIfAborted()
        await this.stk.writePage(addr, image.subarray(addr, addr + pageSize))
        onProgress(addr + pageSize, total)
      }
      for (let addr = 0; addr < end; addr += pageSize) {
        signal.throwIfAborted()
        const back = await this.stk.readPage(addr, pageSize, 'F')
        if (!sameBytes(back, image.subarray(addr, addr + pageSize))) throw new VerifyError(addr)
        onProgress(end + addr + pageSize, total)
      }
    })
  }

  async disconnect(): Promise<void> {
    await this.t.close()
  }
}
```

- [ ] **Step 6: Запустить — тесты проходят**

Run: `npm test -- tests/drivers/avr.test.ts`
Expected: PASS (13 tests). Тесты идут несколько секунд из-за пауз сброса — это нормально.

- [ ] **Step 7: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: протокол STK500v1 и драйвер Arduino с эмулятором загрузчика"
```

---

### Task 6: Драйвер ESP32 поверх esptool-js

**Files:**
- Create: `firmware-site/src/drivers/esp32/esp32Driver.ts`
- Create: `firmware-site/tests/helpers/fakeEspLoader.ts`
- Test: `firmware-site/tests/drivers/esp32.test.ts`

**Interfaces:**
- Consumes: типы и `BoardDriver` (Task 4); `parsePartitionTable`, `PARTITION_TABLE_OFFSET`, `PARTITION_TABLE_SIZE`, `isOtaDataPartition`, `selectAppPartition`, `parseAppDesc`, `espImageLengthFromHeaders`, `looksEncrypted`, `ESP_IMAGE_MAGIC` (Task 3); `u32le`, `hexAddr`, `toArrayBuffer` (Task 1); `buildEspFlash`, `loadFixture` (тестовые помощники Task 2–3).
- Produces:
  - `interface EspLoaderLike` (подмножество `ESPLoader`, код ниже)
  - `type LoaderFactory = (port: SerialPort, baud: number, log: (line: string) => void) => EspLoaderLike`
  - `defaultLoaderFactory: LoaderFactory`
  - `BAUD_STEPS = [921600, 460800, 115200]`
  - `parseFlashSize(s: string | undefined): number`
  - `connectEsp32(port: SerialPort, log: (line: string) => void, factory?: LoaderFactory): Promise<Esp32Driver>`
  - `class Esp32Driver implements BoardDriver` с `readPartitionTable()`, `activeAppPartition()`, `appInfo()`

- [ ] **Step 1: Поддельный ESPLoader**

`firmware-site/tests/helpers/fakeEspLoader.ts`:

```ts
import type { FlashOptions } from 'esptool-js'
import type { EspLoaderLike } from '@/drivers/esp32/esp32Driver'

export interface FakeOptions {
  notEsp?: boolean
  failReadAtBaud?: number[]
}

/** ESP32 с 4 МБ flash: отвечает как esptool-js, но работает с массивом в памяти. */
export class FakeEspLoader implements EspLoaderLike {
  chip?: EspLoaderLike['chip']
  writes: { address: number; length: number; flashMode: string }[] = []
  disconnects = 0
  resets = 0

  constructor(
    public flash: Uint8Array,
    public baud: number,
    private readonly opts: FakeOptions = {},
  ) {}

  transport = {
    disconnect: async () => {
      this.disconnects++
    },
  }

  async main(): Promise<string> {
    if (this.opts.notEsp) throw new Error('Failed to connect with the device')
    this.chip = { CHIP_NAME: 'ESP32', readMac: async () => '7c:df:a1:00:11:22' }
    return 'ESP32-D0WD-V3 (revision v3.1)'
  }

  async detectFlashSize(): Promise<string> {
    return '4MB'
  }

  async readFlash(addr: number, size: number, cb?: ((p: Uint8Array, progress: number, total: number) => void) | null) {
    if (this.opts.failReadAtBaud?.includes(this.baud)) throw new Error('Timeout waiting for packet')
    const out = this.flash.slice(addr, addr + size)
    for (let done = 0x1000; done < size; done += 0x1000) cb?.(new Uint8Array(0), done, size)
    cb?.(new Uint8Array(0), size, size)
    return out
  }

  async writeFlash(o: FlashOptions): Promise<void> {
    for (const f of o.fileArray) {
      o.calculateMD5Hash?.(f.data)
      this.flash.set(f.data, f.address)
      this.writes.push({ address: f.address, length: f.data.length, flashMode: o.flashMode })
      o.reportProgress?.(0, f.data.length, f.data.length)
    }
  }

  async after(): Promise<void> {
    this.resets++
  }
}
```

- [ ] **Step 2: Падающие тесты**

`firmware-site/tests/drivers/esp32.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BAUD_STEPS, connectEsp32, parseFlashSize } from '@/drivers/esp32/esp32Driver'
import { buildEspFlash } from '../helpers/espFlash'
import { loadFixture } from '../helpers/fixtures'
import { FakeEspLoader, type FakeOptions } from '../helpers/fakeEspLoader'

const port = {} as SerialPort
const noop = () => {}
const live = () => new AbortController().signal
const app = loadFixture('esp32-app.bin')
const otaSlot1 = loadFixture('esp32-otadata-slot1.bin')

function setup(flash = buildEspFlash(), opts: FakeOptions = {}) {
  const created: FakeEspLoader[] = []
  const factory = (_p: SerialPort, baud: number) => {
    const l = new FakeEspLoader(flash, baud, opts)
    created.push(l)
    return l
  }
  return { created, connect: () => connectEsp32(port, noop, factory) }
}

describe('parseFlashSize', () => {
  it('понимает ответы esptool-js', () => {
    expect(parseFlashSize('4MB')).toBe(4 * 1024 * 1024)
    expect(parseFlashSize('512KB')).toBe(512 * 1024)
    expect(() => parseFlashSize(undefined)).toThrow(/размер flash/)
  })
})

describe('connectEsp32', () => {
  it('подключается на максимальной скорости и узнаёт чип', async () => {
    const d = await setup().connect()
    expect(d.info).toMatchObject({
      family: 'esp32',
      chip: 'ESP32',
      revision: 'ESP32-D0WD-V3 (revision v3.1)',
      flashSize: 4 * 1024 * 1024,
      mac: '7c:df:a1:00:11:22',
      baud: BAUD_STEPS[0],
    })
  })

  it('если скорость не держится — пробует ниже', async () => {
    const s = setup(buildEspFlash(), { failReadAtBaud: [921600] })
    const d = await s.connect()
    expect(d.info.baud).toBe(460800)
    expect(s.created[0].disconnects).toBe(1)
  })

  it('не ESP32 — сразу ошибка, без перебора скоростей', async () => {
    const s = setup(buildEspFlash(), { notEsp: true })
    await expect(s.connect()).rejects.toThrow(/Failed to connect/)
    expect(s.created).toHaveLength(1)
  })
})

describe('Esp32Driver.read', () => {
  it('вся flash', async () => {
    const flash = buildEspFlash()
    const d = await setup(flash).connect()
    let last = 0
    const r = await d.read({ kind: 'full' }, (done, total) => (last = done / total), live())
    expect(r.baseAddress).toBe(0)
    expect(r.data.length).toBe(flash.length)
    expect(r.data[0x1000]).toBe(0xe9)
    expect(r.notes).toEqual([])
    expect(last).toBe(1)
  })

  it('только приложение: без otadata — ota_0, ровно по длине образа', async () => {
    const d = await setup().connect()
    const r = await d.read({ kind: 'app' }, noop, live())
    expect(r.baseAddress).toBe(0x10000)
    expect(r.partitionLabel).toBe('ota_0')
    expect(Array.from(r.data)).toEqual(Array.from(app))
  })

  it('только приложение: по otadata выбирается активный слот ota_1', async () => {
    const d = await setup(buildEspFlash({ otadata: otaSlot1 })).connect()
    const r = await d.read({ kind: 'app' }, noop, live())
    expect(r.baseAddress).toBe(0x190000)
    expect(r.partitionLabel).toBe('ota_1')
  })

  it('один раздел', async () => {
    const d = await setup().connect()
    const r = await d.read({ kind: 'partition', label: 'nvs' }, noop, live())
    expect(r.baseAddress).toBe(0x9000)
    expect(r.data.length).toBe(0x4000)
    await expect(d.read({ kind: 'partition', label: 'нет' }, noop, live())).rejects.toThrow(/не найден/)
  })

  it('предупреждает о зашифрованной flash', async () => {
    const d = await setup(buildEspFlash({ encrypted: true })).connect()
    const r = await d.read({ kind: 'full' }, noop, live())
    expect(r.notes.join()).toMatch(/зашифрована/)
  })

  it('паспорт активного приложения', async () => {
    const d = await setup().connect()
    const info = await d.appInfo()
    expect(info?.partition.label).toBe('ota_0')
    expect(info?.desc?.version).toBe('1.2.3')
  })

  it('пустая flash — понятная ошибка про таблицу разделов', async () => {
    const d = await setup(new Uint8Array(0x400000).fill(0xff)).connect()
    await expect(d.read({ kind: 'app' }, noop, live())).rejects.toThrow(/Таблица разделов не найдена/)
  })

  it('останавливается по «Стоп»', async () => {
    const d = await setup().connect()
    const ctl = new AbortController()
    ctl.abort()
    await expect(d.read({ kind: 'full' }, noop, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('Esp32Driver.write', () => {
  it('пишет кусками по 256 КБ с сохранением параметров flash', async () => {
    const s = setup(new Uint8Array(0x400000).fill(0xff))
    const d = await s.connect()
    const image = buildEspFlash()
    let last = 0
    await d.write(image, 0, (done, total) => (last = done / total), live())
    const loader = s.created.at(-1)!
    expect(loader.writes).toHaveLength(image.length / 0x40000)
    expect(loader.writes.every((w) => w.flashMode === 'keep')).toBe(true)
    expect(Array.from(loader.flash.subarray(0x10000, 0x10100))).toEqual(Array.from(image.subarray(0x10000, 0x10100)))
    expect(last).toBe(1)
  })

  it('после записи таблица разделов перечитывается', async () => {
    const s = setup(new Uint8Array(0x400000).fill(0xff))
    const d = await s.connect()
    await expect(d.readPartitionTable()).rejects.toThrow()
    await d.write(buildEspFlash(), 0, noop, live())
    expect((await d.readPartitionTable()).map((p) => p.label)).toContain('ota_0')
  })

  it('disconnect перезагружает плату и закрывает порт', async () => {
    const s = setup()
    const d = await s.connect()
    await d.disconnect()
    expect(s.created[0].resets).toBe(1)
    expect(s.created[0].disconnects).toBe(1)
  })
})
```

- [ ] **Step 3: Запустить — тесты падают**

Run: `npm test -- tests/drivers/esp32.test.ts`
Expected: FAIL — `Failed to resolve import "@/drivers/esp32/esp32Driver"`.

- [ ] **Step 4: Реализовать драйвер**

`firmware-site/src/drivers/esp32/esp32Driver.ts`:

```ts
import { ESPLoader, Transport, type FlashOptions } from 'esptool-js'
import SparkMD5 from 'spark-md5'
import { hexAddr, toArrayBuffer, u32le } from '@/analysis/bytes'
import { parseAppDesc } from '@/analysis/appDesc'
import { ESP_IMAGE_MAGIC, espImageLengthFromHeaders, looksEncrypted } from '@/analysis/espImage'
import { selectAppPartition } from '@/analysis/otadata'
import {
  isOtaDataPartition,
  PARTITION_TABLE_OFFSET,
  PARTITION_TABLE_SIZE,
  parsePartitionTable,
  type Partition,
} from '@/analysis/partitions'
import type { AppInfo, BoardDriver, BoardInfo, Progress, ReadResult, ReadTarget } from '../types'

/** То, чем мы пользуемся из ESPLoader, — чтобы в тестах подставить поддельный загрузчик. */
export interface EspLoaderLike {
  chip?: { CHIP_NAME: string; readMac(loader: never): Promise<string> }
  main(mode?: 'default_reset'): Promise<string>
  detectFlashSize(): Promise<string | undefined>
  readFlash(
    addr: number,
    size: number,
    onPacket?: ((packet: Uint8Array, progress: number, total: number) => void) | null,
  ): Promise<Uint8Array>
  writeFlash(options: FlashOptions): Promise<void>
  after(mode?: 'hard_reset'): Promise<void>
  transport: { disconnect(): Promise<void> }
}

export type LoaderFactory = (port: SerialPort, baud: number, log: (line: string) => void) => EspLoaderLike

export const defaultLoaderFactory: LoaderFactory = (port, baud, log) => {
  const transport = new Transport(port, false)
  const terminal = { clean() {}, writeLine: (s: string) => log(s), write: (s: string) => log(s) }
  return new ESPLoader({ transport, baudrate: baud, romBaudrate: 115200, terminal }) as unknown as EspLoaderLike
}

export const BAUD_STEPS = [921600, 460800, 115200]
const READ_CHUNK = 0x10000
const WRITE_CHUNK = 0x40000

export function parseFlashSize(s: string | undefined): number {
  const m = /^(\d+)(KB|MB)/.exec(s ?? '')
  if (!m) throw new Error(`Не удалось определить размер flash (${s ?? 'нет ответа'})`)
  return Number(m[1]) * (m[2] === 'MB' ? 1024 * 1024 : 1024)
}

export async function connectEsp32(
  port: SerialPort,
  log: (line: string) => void,
  factory: LoaderFactory = defaultLoaderFactory,
): Promise<Esp32Driver> {
  let lastError: unknown
  for (const baud of BAUD_STEPS) {
    const loader = factory(port, baud, log)
    try {
      const description = await loader.main('default_reset')
      await loader.readFlash(0, 0x1000) // проверяем, что выбранная скорость держится
      const flashSize = parseFlashSize(await loader.detectFlashSize())
      const chip = loader.chip!
      const mac = await chip.readMac(loader as never)
      return new Esp32Driver(loader, { family: 'esp32', chip: chip.CHIP_NAME, revision: description, flashSize, mac, baud })
    } catch (e) {
      lastError = e
      await loader.transport.disconnect().catch(() => {})
      if (!loader.chip) break // это вообще не ESP32 — другие скорости не помогут
      log(`Скорость ${baud} не держится, пробую ниже`)
    }
  }
  throw lastError
}

export class Esp32Driver implements BoardDriver {
  private partitions: Partition[] | null = null

  constructor(
    private readonly loader: EspLoaderLike,
    readonly info: BoardInfo,
  ) {}

  private async readRange(addr: number, size: number, onProgress: Progress, signal: AbortSignal): Promise<Uint8Array> {
    const out = new Uint8Array(size)
    for (let off = 0; off < size; off += READ_CHUNK) {
      signal.throwIfAborted()
      const len = Math.min(READ_CHUNK, size - off)
      const part = await this.loader.readFlash(addr + off, len, (_p, progress) => onProgress(off + progress, size))
      out.set(part.subarray(0, len), off)
    }
    onProgress(size, size)
    return out
  }

  async readPartitionTable(): Promise<Partition[]> {
    if (!this.partitions) {
      const parts = parsePartitionTable(await this.loader.readFlash(PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE))
      if (!parts.length) throw new Error('Таблица разделов не найдена — flash пустая или зашифрована')
      this.partitions = parts
    }
    return this.partitions
  }

  async activeAppPartition(): Promise<Partition | null> {
    const parts = await this.readPartitionTable()
    const ota = parts.find(isOtaDataPartition)
    const otadata = ota ? await this.loader.readFlash(ota.offset, Math.min(ota.size, 0x2000)) : null
    return selectAppPartition(parts, otadata)
  }

  async appInfo(): Promise<AppInfo | null> {
    const partition = await this.activeAppPartition()
    if (!partition) return null
    const head = await this.loader.readFlash(partition.offset, 0x200)
    return { partition, desc: parseAppDesc(head, 0) }
  }

  /** Длина образа по заголовкам сегментов — чтобы не читать весь раздел ради 200 КБ приложения. */
  private async imageLength(addr: number, max: number): Promise<number | null> {
    const header = await this.loader.readFlash(addr, 24)
    const count = header[1]
    if (header[0] !== ESP_IMAGE_MAGIC || count === 0 || count > 16) return null
    const lengths: number[] = []
    let pos = 24
    for (let i = 0; i < count; i++) {
      const seg = await this.loader.readFlash(addr + pos, 8)
      const len = u32le(seg, 4)
      pos += 8 + len
      if (pos > max) return null
      lengths.push(len)
    }
    const total = espImageLengthFromHeaders(header, lengths)
    return total <= max ? total : null
  }

  async read(target: ReadTarget, onProgress: Progress, signal: AbortSignal): Promise<ReadResult> {
    signal.throwIfAborted()
    if (target.kind === 'full') {
      const data = await this.readRange(0, this.info.flashSize, onProgress, signal)
      const notes = looksEncrypted(data, 0, this.info.chip)
        ? ['Похоже, flash зашифрована: дамп сохранён, но на другой плате он работать не будет']
        : []
      return { data, baseAddress: 0, notes }
    }
    if (target.kind === 'partition') {
      const p = (await this.readPartitionTable()).find((x) => x.label === target.label)
      if (!p) throw new Error(`Раздел «${target.label}» не найден`)
      const data = await this.readRange(p.offset, p.size, onProgress, signal)
      return { data, baseAddress: p.offset, notes: [], partitionLabel: p.label }
    }
    const app = await this.activeAppPartition()
    if (!app) throw new Error('На плате нет раздела с приложением')
    const length = await this.imageLength(app.offset, app.size)
    const data = await this.readRange(app.offset, length ?? app.size, onProgress, signal)
    const notes = [`Раздел ${app.label} (${hexAddr(app.offset)})`]
    if (length === null) notes.push('Заголовок приложения не распознан — сохранён весь раздел')
    return { data, baseAddress: app.offset, notes, partitionLabel: app.label }
  }

  async write(data: Uint8Array, address: number, onProgress: Progress, signal: AbortSignal): Promise<void> {
    this.partitions = null // после записи таблица разделов могла измениться
    for (let off = 0; off < data.length; off += WRITE_CHUNK) {
      signal.throwIfAborted()
      const chunk = data.subarray(off, Math.min(off + WRITE_CHUNK, data.length))
      await this.loader.writeFlash({
        fileArray: [{ data: chunk, address: address + off }],
        flashMode: 'keep',
        flashFreq: 'keep',
        flashSize: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (_i, written, total) => onProgress(off + Math.round((chunk.length * written) / (total || 1)), data.length),
        calculateMD5Hash: (image) => SparkMD5.ArrayBuffer.hash(toArrayBuffer(image)),
      })
    }
    onProgress(data.length, data.length)
  }

  async disconnect(): Promise<void> {
    await this.loader.after('hard_reset').catch(() => {})
    await this.loader.transport.disconnect().catch(() => {})
  }
}
```

- [ ] **Step 5: Запустить — тесты проходят**

Run: `npm test -- tests/drivers/esp32.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 6: Проверить типы с настоящим esptool-js**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: без ошибок. Если TypeScript ругается на `as unknown as EspLoaderLike` — оставить приведение (оно намеренное), исправлять только реальные несовпадения имён методов.

- [ ] **Step 7: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: драйвер ESP32 на esptool-js — чтение, запись, разделы"
```

---

### Task 7: Автоопределение платы и понятные ошибки

**Files:**
- Create: `firmware-site/src/drivers/detect.ts`
- Create: `firmware-site/src/drivers/explainError.ts`
- Test: `firmware-site/tests/drivers/detect.test.ts`, `firmware-site/tests/drivers/explainError.test.ts`

**Interfaces:**
- Consumes: `connectAvr` (Task 5); `connectEsp32` (Task 6); `WebSerialTransport` (Task 4); ошибки (Task 4); `SerialTimeoutError` (Task 4).
- Produces:
  - `type Probe = 'esp32' | 'avr115200' | 'avr57600'`, `probeOrder(info: Partial<SerialPortInfo>): Probe[]`
  - `interface DetectDeps { esp32(port: SerialPort, log: Log): Promise<BoardDriver>; avr(port: SerialPort, baud: number): Promise<BoardDriver> }`, `defaultDetectDeps`
  - `type Log = (line: string) => void`
  - `detectBoard(port: SerialPort, log: Log, deps?: DetectDeps): Promise<BoardDriver>`
  - `isPortBusy(e: unknown): boolean`
  - `interface ExplainedError { title: string; hint?: string; raw: string; silent?: boolean }`
  - `explainError(e: unknown): ExplainedError`

- [ ] **Step 1: Падающие тесты**

`firmware-site/tests/drivers/detect.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { detectBoard, probeOrder, type DetectDeps } from '@/drivers/detect'
import { BoardNotFoundError, UnsupportedChipError } from '@/drivers/errors'
import type { BoardDriver } from '@/drivers/types'

const portWith = (usbVendorId?: number) => ({ getInfo: () => ({ usbVendorId, usbProductId: 1 }) }) as unknown as SerialPort
const fakeDriver = (chip: string) => ({ info: { chip } }) as unknown as BoardDriver
const noop = () => {}

function deps(results: { esp32?: BoardDriver | Error; avr115200?: BoardDriver | Error; avr57600?: BoardDriver | Error }) {
  const calls: string[] = []
  const settle = (r: BoardDriver | Error | undefined) =>
    r instanceof Error ? Promise.reject(r) : r ? Promise.resolve(r) : Promise.reject(new Error('нет ответа'))
  const d: DetectDeps = {
    esp32: async () => {
      calls.push('esp32')
      return settle(results.esp32)
    },
    avr: async (_p, baud) => {
      calls.push(`avr${baud}`)
      return settle(baud === 115200 ? results.avr115200 : results.avr57600)
    },
  }
  return { d, calls }
}

describe('probeOrder', () => {
  it('Espressif и CP210x — сначала ESP32, остальные — сначала AVR', () => {
    expect(probeOrder({ usbVendorId: 0x303a })[0]).toBe('esp32')
    expect(probeOrder({ usbVendorId: 0x10c4 })[0]).toBe('esp32')
    expect(probeOrder({ usbVendorId: 0x1a86 })).toEqual(['avr115200', 'avr57600', 'esp32'])
    expect(probeOrder({})).toEqual(['avr115200', 'avr57600', 'esp32'])
  })
})

describe('detectBoard', () => {
  it('возвращает первый ответивший драйвер', async () => {
    const { d, calls } = deps({ avr57600: fakeDriver('ATmega328P') })
    const driver = await detectBoard(portWith(0x1a86), noop, d)
    expect(driver.info.chip).toBe('ATmega328P')
    expect(calls).toEqual(['avr115200', 'avr57600'])
  })

  it('никто не ответил — BoardNotFoundError со всеми попытками', async () => {
    const { d } = deps({})
    await expect(detectBoard(portWith(0x1a86), noop, d)).rejects.toSatisfy(
      (e: unknown) => e instanceof BoardNotFoundError && e.attempts.length === 3,
    )
  })

  it('неподдерживаемый чип останавливает перебор', async () => {
    const { d, calls } = deps({ avr115200: new UnsupportedChipError('сигнатура 1E 98 01') })
    await expect(detectBoard(portWith(0x1a86), noop, d)).rejects.toBeInstanceOf(UnsupportedChipError)
    expect(calls).toEqual(['avr115200'])
  })

  it('занятый порт останавливает перебор', async () => {
    const busy = new DOMException('Failed to open serial port.', 'NetworkError')
    const { d, calls } = deps({ esp32: busy })
    await expect(detectBoard(portWith(0x10c4), noop, d)).rejects.toBe(busy)
    expect(calls).toEqual(['esp32'])
  })
})
```

`firmware-site/tests/drivers/explainError.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { explainError } from '@/drivers/explainError'
import { BoardNotFoundError, DeviceLostError, UnsupportedChipError, VerifyError } from '@/drivers/errors'
import { SerialTimeoutError } from '@/serial/transport'

describe('explainError', () => {
  it('отмена выбора порта — молча', () => {
    expect(explainError(new DOMException('No port selected by the user.', 'NotFoundError')).silent).toBe(true)
  })

  it('порт занят', () => {
    const e = explainError(new DOMException('Failed to open serial port.', 'NetworkError'))
    expect(e.title).toBe('Порт занят другой программой')
    expect(e.hint).toMatch(/Arduino IDE/)
  })

  it('кабель отключён', () => {
    expect(explainError(new DeviceLostError()).title).toBe('Кабель отключён')
    expect(explainError(new DOMException('The device has been lost.', 'NetworkError')).title).toBe('Кабель отключён')
    expect(explainError(new DeviceLostError()).hint).toMatch(/загрузчик не пострадал/)
  })

  it('плата не отвечает — совет про BOOT/EN и DTR', () => {
    const e = explainError(new BoardNotFoundError(['a', 'b']))
    expect(e.title).toBe('Плата не отвечает')
    expect(e.hint).toMatch(/BOOT/)
    expect(e.hint).toMatch(/DTR/)
    expect(e.raw).toMatch(/a/)
  })

  it('чип, проверка, таймаут, отмена, место', () => {
    expect(explainError(new UnsupportedChipError('x')).title).toBe('Чип не поддерживается')
    expect(explainError(new VerifyError(0x100)).title).toBe('Проверка после записи не прошла')
    expect(explainError(new Error('MD5 of file does not match data in flash!')).title).toBe('Проверка после записи не прошла')
    expect(explainError(new SerialTimeoutError(1, 0)).title).toBe('Плата перестала отвечать')
    expect(explainError(new DOMException('aborted', 'AbortError')).title).toBe('Операция остановлена')
    expect(explainError(new DOMException('full', 'QuotaExceededError')).title).toBe('Не хватило места в браузере')
  })

  it('русское сообщение показывается как есть, прочее — общим текстом', () => {
    expect(explainError(new Error('Раздел «x» не найден')).title).toBe('Раздел «x» не найден')
    const e = explainError(new Error('weird'))
    expect(e.title).toBe('Что-то пошло не так')
    expect(e.raw).toBe('Error: weird')
  })
})
```

- [ ] **Step 2: Запустить — тесты падают**

Run: `npm test -- tests/drivers/detect.test.ts tests/drivers/explainError.test.ts`
Expected: FAIL — `Failed to resolve import "@/drivers/detect"`.

- [ ] **Step 3: Реализовать автоопределение**

`firmware-site/src/drivers/detect.ts`:

```ts
import { WebSerialTransport } from '@/serial/webSerialTransport'
import { connectAvr } from './avr/avrDriver'
import { connectEsp32 } from './esp32/esp32Driver'
import { BoardNotFoundError, UnsupportedChipError } from './errors'
import type { BoardDriver } from './types'

export type Log = (line: string) => void
export type Probe = 'esp32' | 'avr115200' | 'avr57600'

const PROBE_LABELS: Record<Probe, string> = {
  esp32: 'ESP32',
  avr115200: 'Arduino (115200)',
  avr57600: 'Arduino (57600)',
}

const ESPRESSIF_VID = 0x303a
const SILABS_VID = 0x10c4

/** Проба AVR быстрая (~1,5 с), проба ESP32 долгая — поэтому AVR первой, если адаптер не «ESP-шный». */
export function probeOrder(info: Partial<SerialPortInfo>): Probe[] {
  const espFirst = info.usbVendorId === ESPRESSIF_VID || info.usbVendorId === SILABS_VID
  return espFirst ? ['esp32', 'avr115200', 'avr57600'] : ['avr115200', 'avr57600', 'esp32']
}

export interface DetectDeps {
  esp32(port: SerialPort, log: Log): Promise<BoardDriver>
  avr(port: SerialPort, baud: number): Promise<BoardDriver>
}

export const defaultDetectDeps: DetectDeps = {
  esp32: (port, log) => connectEsp32(port, log),
  avr: (port, baud) => connectAvr(new WebSerialTransport(port), baud),
}

/** Порт открыт другой программой или уже открыт на этой странице — перебирать дальше бессмысленно. */
export function isPortBusy(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name
  const message = e instanceof Error ? e.message : ''
  return name === 'InvalidStateError' || (name === 'NetworkError' && /open/i.test(message))
}

export async function detectBoard(port: SerialPort, log: Log, deps: DetectDeps = defaultDetectDeps): Promise<BoardDriver> {
  const attempts: string[] = []
  for (const probe of probeOrder(port.getInfo())) {
    log(`Пробую: ${PROBE_LABELS[probe]}`)
    try {
      return probe === 'esp32' ? await deps.esp32(port, log) : await deps.avr(port, probe === 'avr115200' ? 115200 : 57600)
    } catch (e) {
      if (e instanceof UnsupportedChipError || isPortBusy(e)) throw e
      const message = e instanceof Error ? e.message : String(e)
      attempts.push(`${PROBE_LABELS[probe]}: ${message}`)
      log(`${PROBE_LABELS[probe]} не ответила: ${message}`)
    }
  }
  throw new BoardNotFoundError(attempts)
}
```

- [ ] **Step 4: Реализовать перевод ошибок**

`firmware-site/src/drivers/explainError.ts`:

```ts
import { BoardNotFoundError, DeviceLostError, UnsupportedChipError, VerifyError } from './errors'

export interface ExplainedError {
  title: string
  hint?: string
  raw: string
  /** Не показывать пользователю (например, он сам закрыл окно выбора порта). */
  silent?: boolean
}

const LOST_HINT =
  'Подключите плату и повторите. Если прерывалась запись — залейте прошивку ещё раз: загрузчик не пострадал.'

export function explainError(e: unknown): ExplainedError {
  const name = (e as { name?: string } | null)?.name ?? ''
  const message = e instanceof Error ? e.message : String(e)
  const raw =
    e instanceof BoardNotFoundError
      ? [message, ...e.attempts].join('\n')
      : e instanceof Error
        ? `${name}: ${message}`
        : String(e)

  if (name === 'NotFoundError') return { title: 'Порт не выбран', raw, silent: true }
  if (name === 'InvalidStateError' || (name === 'NetworkError' && /open/i.test(message))) {
    return {
      title: 'Порт занят другой программой',
      hint: 'Закройте Arduino IDE, монитор порта, PlatformIO или другую вкладку с этим сайтом и попробуйте снова.',
      raw,
    }
  }
  if (e instanceof DeviceLostError || name === 'NetworkError' || /device has been lost|disconnected/i.test(message)) {
    return { title: 'Кабель отключён', hint: LOST_HINT, raw }
  }
  if (e instanceof BoardNotFoundError) {
    return {
      title: 'Плата не отвечает',
      hint:
        'ESP32: зажмите BOOT, нажмите и отпустите EN (RST), отпустите BOOT и подключитесь снова. ' +
        'Arduino: проверьте, что выбран порт этой платы; для Pro Mini нужен USB-адаптер с выводом DTR.',
      raw,
    }
  }
  if (e instanceof UnsupportedChipError) {
    return {
      title: 'Чип не поддерживается',
      hint: 'Поддерживаются Arduino Uno / Nano / Pro Mini (ATmega328P) и ESP32, ESP32-S2, ESP32-S3, ESP32-C3.',
      raw,
    }
  }
  if (e instanceof VerifyError || /MD5 of file does not match/i.test(message)) {
    return {
      title: 'Проверка после записи не прошла',
      hint: 'Залейте прошивку ещё раз. Если ошибка повторяется — попробуйте другой кабель или плату.',
      raw,
    }
  }
  if (name === 'AbortError') return { title: 'Операция остановлена', raw }
  if (name === 'QuotaExceededError') {
    return {
      title: 'Не хватило места в браузере',
      hint: 'Файл всё равно можно скачать. Чтобы сохранить в Библиотеку, удалите старые прошивки.',
      raw,
    }
  }
  if (name === 'SerialTimeoutError' || /timeout|timed out/i.test(message)) {
    return {
      title: 'Плата перестала отвечать',
      hint: 'Проверьте кабель и повторите. Если не помогает — отключите и снова подключите плату.',
      raw,
    }
  }
  if (/[а-яё]/i.test(message)) return { title: message, raw }
  return { title: 'Что-то пошло не так', hint: 'Подробности — в журнале внизу страницы.', raw }
}
```

- [ ] **Step 5: Запустить — тесты проходят**

Run: `npm test -- tests/drivers`
Expected: PASS (все тесты драйверов).

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: автоопределение платы и понятные сообщения об ошибках"
```

---

### Task 8: Библиотека прошивок (IndexedDB) и импорт файлов

**Files:**
- Create: `firmware-site/src/library/db.ts`
- Create: `firmware-site/src/library/library.ts`
- Create: `firmware-site/src/library/identify.ts`
- Create: `firmware-site/src/library/naming.ts`
- Test: `firmware-site/tests/library/library.test.ts`, `firmware-site/tests/library/identify.test.ts`

**Interfaces:**
- Consumes: `sha256Hex` (Task 1); `parseIntelHex` (Task 2); `parseEspImage`, `parseAppDesc`, `parsePartitionTable`, `PARTITION_TABLE_OFFSET`, `PARTITION_TABLE_SIZE` (Task 3); `Family` (Task 4).
- Produces:
  - `type DumpKind = 'full' | 'app' | 'partition'`
  - `interface FirmwareRecord { id: number; name: string; family: Family; chip: string; kind: DumpKind; partitionLabel?: string; baseAddress: number; size: number; sha256: string; createdAt: number; note: string; source: 'board' | 'file'; appName?: string; appVersion?: string; hasEeprom: boolean }`
  - `interface FirmwareBlob { id: number; data: Uint8Array; eeprom?: Uint8Array }`
  - `db` (Dexie, база `pauluk-firmware`)
  - `interface NewFirmware { name; family; chip; kind; partitionLabel?; baseAddress; data; eeprom?; note?; source; appName?; appVersion? }`
  - `saveFirmware(input: NewFirmware): Promise<FirmwareRecord>`
  - `listFirmware(): Promise<FirmwareRecord[]>` (новые сверху)
  - `getFirmware(id: number): Promise<FirmwareRecord | undefined>`, `getFirmwareData(id: number): Promise<FirmwareBlob | undefined>`
  - `updateFirmware(id: number, patch: Partial<Pick<FirmwareRecord, 'name' | 'note'>>): Promise<void>`, `deleteFirmware(id: number): Promise<void>`
  - `storageEstimate(): Promise<{ usage: number; quota: number } | null>`
  - `KIND_LABELS: Record<DumpKind, string>`, `kindLabel(r: Pick<FirmwareRecord, 'kind' | 'partitionLabel'>): string`
  - `interface IdentifiedFile { name: string; family: Family | null; chip: string | null; kind: DumpKind; baseAddress: number; data: Uint8Array; appName?: string; appVersion?: string }`
  - `identifyFile(fileName: string, bytes: Uint8Array): IdentifiedFile`
  - `MANUAL_CHIPS: { chip: string; family: Family }[]`
  - `defaultName(chip: string, label: string | undefined, date: Date): string`

- [ ] **Step 1: Падающие тесты**

`firmware-site/tests/library/library.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/library/db'
import {
  deleteFirmware,
  getFirmware,
  getFirmwareData,
  kindLabel,
  listFirmware,
  saveFirmware,
  updateFirmware,
  type NewFirmware,
} from '@/library/library'
import { defaultName } from '@/library/naming'

const sample = (name: string, data = Uint8Array.of(1, 2, 3)): NewFirmware => ({
  name,
  family: 'avr',
  chip: 'ATmega328P',
  kind: 'full',
  baseAddress: 0,
  data,
  source: 'board',
})

beforeEach(async () => {
  await db.records.clear()
  await db.blobs.clear()
})
afterEach(() => vi.restoreAllMocks())

describe('library', () => {
  it('сохраняет запись с размером, SHA-256 и байтами отдельно', async () => {
    const rec = await saveFirmware({ ...sample('a'), eeprom: Uint8Array.of(9) })
    expect(rec).toMatchObject({ name: 'a', size: 3, note: '', hasEeprom: true })
    expect(rec.sha256).toBe('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81')
    const blob = await getFirmwareData(rec.id)
    expect(Array.from(blob!.data)).toEqual([1, 2, 3])
    expect(Array.from(blob!.eeprom!)).toEqual([9])
  })

  it('список — новые сверху', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000)
    await saveFirmware(sample('старая'))
    await saveFirmware(sample('новая'))
    expect((await listFirmware()).map((r) => r.name)).toEqual(['новая', 'старая'])
  })

  it('переименование, заметка и удаление', async () => {
    const rec = await saveFirmware(sample('a'))
    await updateFirmware(rec.id, { name: 'b', note: 'с дачи' })
    expect(await getFirmware(rec.id)).toMatchObject({ name: 'b', note: 'с дачи' })
    await deleteFirmware(rec.id)
    expect(await getFirmware(rec.id)).toBeUndefined()
    expect(await getFirmwareData(rec.id)).toBeUndefined()
  })

  it('подписи типа дампа', () => {
    expect(kindLabel({ kind: 'full' })).toBe('Вся flash')
    expect(kindLabel({ kind: 'app' })).toBe('Приложение')
    expect(kindLabel({ kind: 'partition', partitionLabel: 'nvs' })).toBe('Раздел nvs')
  })
})

describe('defaultName', () => {
  it('чип, имя проекта и время, без запрещённых в Windows символов', () => {
    const d = new Date(2026, 8, 30, 15, 7)
    expect(defaultName('ESP32-S3', 'blink', d)).toBe('ESP32-S3_blink_2026-09-30_15-07')
    expect(defaultName('ATmega328P', undefined, d)).toBe('ATmega328P_firmware_2026-09-30_15-07')
    expect(defaultName('ESP32', 'my app:v2', d)).toBe('ESP32_my_app_v2_2026-09-30_15-07')
  })
})
```

`firmware-site/tests/library/identify.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { identifyFile, MANUAL_CHIPS } from '@/library/identify'
import { loadFixture } from '../helpers/fixtures'
import { buildEspFlash } from '../helpers/espFlash'

describe('identifyFile', () => {
  it('.hex — прошивка Arduino', () => {
    const f = identifyFile('blink.ino.hex', loadFixture('avr-blink.hex'))
    expect(f).toMatchObject({ name: 'blink.ino', family: 'avr', chip: 'ATmega328P', kind: 'full', baseAddress: 0 })
    expect(f.data[0]).toBe(0x0c)
  })

  it('битый .hex — ошибка с номером строки', () => {
    expect(() => identifyFile('x.hex', new TextEncoder().encode(':00000001FE\n'))).toThrow(/Строка 1/)
  })

  it('приложение ESP32 с паспортом', () => {
    expect(identifyFile('app.bin', loadFixture('esp32-app.bin'))).toMatchObject({
      family: 'esp32',
      chip: 'ESP32',
      kind: 'app',
      baseAddress: 0x10000,
      appName: 'pauluk_fixture',
      appVersion: '1.2.3',
    })
  })

  it('полная flash ESP32 (загрузчик на 0x1000)', () => {
    expect(identifyFile('dump.bin', buildEspFlash())).toMatchObject({ family: 'esp32', chip: 'ESP32', kind: 'full', baseAddress: 0 })
  })

  it('полная flash ESP32-S3 (загрузчик на 0x0)', () => {
    const flash = new Uint8Array(0x10000).fill(0xff)
    const boot = loadFixture('esp32-bootloader.bin').slice()
    boot[12] = 9 // chip_id ESP32-S3
    flash.set(boot, 0)
    flash.set(loadFixture('esp32-partitions.bin'), 0x8000)
    expect(identifyFile('s3.bin', flash)).toMatchObject({ family: 'esp32', chip: 'ESP32-S3', kind: 'full' })
  })

  it('неизвестные байты — чип выбирает пользователь', () => {
    expect(identifyFile('raw.bin', Uint8Array.of(1, 2, 3))).toMatchObject({ family: null, chip: null, kind: 'full', baseAddress: 0 })
    expect(MANUAL_CHIPS.map((c) => c.chip)).toEqual(['ATmega328P', 'ESP32', 'ESP32-S2', 'ESP32-S3', 'ESP32-C3'])
  })
})
```

- [ ] **Step 2: Запустить — тесты падают**

Run: `npm test -- tests/library`
Expected: FAIL — `Failed to resolve import "@/library/db"`.

- [ ] **Step 3: Реализовать хранилище**

`firmware-site/src/library/db.ts`:

```ts
import Dexie, { type EntityTable } from 'dexie'
import type { Family } from '@/drivers/types'

export type DumpKind = 'full' | 'app' | 'partition'

export interface FirmwareRecord {
  id: number
  name: string
  family: Family
  chip: string
  kind: DumpKind
  partitionLabel?: string
  baseAddress: number
  size: number
  sha256: string
  createdAt: number
  note: string
  source: 'board' | 'file'
  appName?: string
  appVersion?: string
  hasEeprom: boolean
}

/** Байты лежат отдельно, чтобы список библиотеки не тянул мегабайты. */
export interface FirmwareBlob {
  id: number
  data: Uint8Array
  eeprom?: Uint8Array
}

export const db = new Dexie('pauluk-firmware') as Dexie & {
  records: EntityTable<FirmwareRecord, 'id'>
  blobs: EntityTable<FirmwareBlob, 'id'>
}

db.version(1).stores({
  records: '++id, createdAt',
  blobs: 'id',
})
```

`firmware-site/src/library/library.ts`:

```ts
import { sha256Hex } from '@/analysis/hash'
import type { Family } from '@/drivers/types'
import { db, type DumpKind, type FirmwareBlob, type FirmwareRecord } from './db'

export type { DumpKind, FirmwareBlob, FirmwareRecord }

export interface NewFirmware {
  name: string
  family: Family
  chip: string
  kind: DumpKind
  partitionLabel?: string
  baseAddress: number
  data: Uint8Array
  eeprom?: Uint8Array
  note?: string
  source: 'board' | 'file'
  appName?: string
  appVersion?: string
}

export async function saveFirmware(input: NewFirmware): Promise<FirmwareRecord> {
  const { data, eeprom, ...meta } = input
  const record: Omit<FirmwareRecord, 'id'> = {
    ...meta,
    note: meta.note ?? '',
    size: data.length,
    sha256: await sha256Hex(data),
    createdAt: Date.now(),
    hasEeprom: eeprom !== undefined,
  }
  const id = await db.transaction('rw', db.records, db.blobs, async () => {
    const newId = await db.records.add(record)
    await db.blobs.add({ id: newId, data, eeprom })
    return newId
  })
  return { ...record, id }
}

export function listFirmware(): Promise<FirmwareRecord[]> {
  return db.records.orderBy('createdAt').reverse().toArray()
}

export function getFirmware(id: number): Promise<FirmwareRecord | undefined> {
  return db.records.get(id)
}

export function getFirmwareData(id: number): Promise<FirmwareBlob | undefined> {
  return db.blobs.get(id)
}

export async function updateFirmware(id: number, patch: Partial<Pick<FirmwareRecord, 'name' | 'note'>>): Promise<void> {
  await db.records.update(id, patch)
}

export async function deleteFirmware(id: number): Promise<void> {
  await db.transaction('rw', db.records, db.blobs, async () => {
    await db.records.delete(id)
    await db.blobs.delete(id)
  })
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  const e = await navigator.storage.estimate()
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
}

export const KIND_LABELS: Record<DumpKind, string> = {
  full: 'Вся flash',
  app: 'Приложение',
  partition: 'Раздел',
}

export function kindLabel(r: Pick<FirmwareRecord, 'kind' | 'partitionLabel'>): string {
  return r.kind === 'partition' && r.partitionLabel ? `Раздел ${r.partitionLabel}` : KIND_LABELS[r.kind]
}
```

`firmware-site/src/library/naming.ts`:

```ts
/** Имя по умолчанию: «ESP32-S3_blink_2026-09-30_15-07». Символы, запрещённые в именах файлов Windows, — в «_». */
export function defaultName(chip: string, label: string | undefined, date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}`
  return [chip, label || 'firmware', stamp].join('_').replace(/[\\/:*?"<>|\s]+/g, '_')
}
```

`firmware-site/src/library/identify.ts`:

```ts
import { parseAppDesc } from '@/analysis/appDesc'
import { parseEspImage } from '@/analysis/espImage'
import { parseIntelHex } from '@/analysis/intelHex'
import { PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE, parsePartitionTable } from '@/analysis/partitions'
import type { Family } from '@/drivers/types'
import type { DumpKind } from './db'

export interface IdentifiedFile {
  name: string
  family: Family | null
  chip: string | null
  kind: DumpKind
  baseAddress: number
  data: Uint8Array
  appName?: string
  appVersion?: string
}

/** Варианты для ручного выбора, когда по содержимому файла чип не определить. */
export const MANUAL_CHIPS: { chip: string; family: Family }[] = [
  { chip: 'ATmega328P', family: 'avr' },
  { chip: 'ESP32', family: 'esp32' },
  { chip: 'ESP32-S2', family: 'esp32' },
  { chip: 'ESP32-S3', family: 'esp32' },
  { chip: 'ESP32-C3', family: 'esp32' },
]

const DEFAULT_APP_OFFSET = 0x10000

function hasPartitionTable(bytes: Uint8Array): boolean {
  const end = PARTITION_TABLE_OFFSET + PARTITION_TABLE_SIZE
  return bytes.length >= end && parsePartitionTable(bytes.subarray(PARTITION_TABLE_OFFSET, end)).length > 0
}

export function identifyFile(fileName: string, bytes: Uint8Array): IdentifiedFile {
  const name = fileName.replace(/\.[^.]+$/, '')
  if (/\.hex$/i.test(fileName)) {
    const img = parseIntelHex(new TextDecoder().decode(bytes))
    return { name, family: 'avr', chip: 'ATmega328P', kind: 'full', baseAddress: img.baseAddress, data: img.data }
  }
  // Полный дамп ESP32/ESP32-S2: загрузчик на 0x1000 и таблица разделов на 0x8000.
  const bootAt1000 = parseEspImage(bytes, 0x1000)
  if (bootAt1000?.chipName && hasPartitionTable(bytes)) {
    return { name, family: 'esp32', chip: bootAt1000.chipName, kind: 'full', baseAddress: 0, data: bytes }
  }
  const atZero = parseEspImage(bytes, 0)
  if (atZero?.chipName) {
    const desc = parseAppDesc(bytes, 0)
    if (desc) {
      return {
        name,
        family: 'esp32',
        chip: atZero.chipName,
        kind: 'app',
        baseAddress: DEFAULT_APP_OFFSET,
        data: bytes,
        appName: desc.projectName,
        appVersion: desc.version,
      }
    }
    // Полный дамп S3/C3: загрузчик на 0x0.
    if (hasPartitionTable(bytes)) return { name, family: 'esp32', chip: atZero.chipName, kind: 'full', baseAddress: 0, data: bytes }
  }
  return { name, family: null, chip: null, kind: 'full', baseAddress: 0, data: bytes }
}
```

- [ ] **Step 4: Запустить — тесты проходят**

Run: `npm test -- tests/library`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: библиотека прошивок в IndexedDB и распознавание файлов"
```

---

### Task 9: Анализ прошивки и проверка совместимости перед заливкой

**Files:**
- Create: `firmware-site/src/analysis/analyze.ts`
- Create: `firmware-site/src/flash/compat.ts`
- Test: `firmware-site/tests/analysis/analyze.test.ts`, `firmware-site/tests/flash/compat.test.ts`

**Interfaces:**
- Consumes: `usage` (Task 1); `parseEspImage`, `bootloaderOffset`, `looksEncrypted`, `ESP_IMAGE_MAGIC`, `parseAppDesc`, `parsePartitionTable`, `isOtaDataPartition`, `selectAppPartition`, `PARTITION_TABLE_*` (Task 3); `appAreaEnd` (Task 5); `BoardInfo`, `Family` (Task 4); `DumpKind` (Task 8); `formatSize`, `hexAddr` (Task 1).
- Produces:
  - `interface FirmwareAnalysis { usage: Usage; bootloader: EspImage | null; image: EspImage | null; appDesc: AppDesc | null; appOffset: number | null; partitions: Partition[]; encrypted: boolean | null }`
  - `analyzeFirmware(meta: { family: Family; chip: string; kind: DumpKind; baseAddress: number }, data: Uint8Array): FirmwareAnalysis`
  - `interface CompatInput { firmware: { family: Family; chip: string; kind: DumpKind; size: number; partitionLabel?: string }; board: BoardInfo; partitions?: Partition[]; activeApp?: Partition | null }`
  - `type CompatResult = { ok: true; address: number; warnings: string[] } | { ok: false; reason: string }`
  - `checkCompatibility(input: CompatInput): CompatResult`

- [ ] **Step 1: Падающие тесты**

`firmware-site/tests/analysis/analyze.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { analyzeFirmware } from '@/analysis/analyze'
import { parseIntelHex } from '@/analysis/intelHex'
import { buildEspFlash } from '../helpers/espFlash'
import { loadFixture, loadFixtureText } from '../helpers/fixtures'

const esp = { family: 'esp32' as const, chip: 'ESP32' }

describe('analyzeFirmware', () => {
  it('полная flash ESP32: разделы, загрузчик, паспорт активного приложения', () => {
    const a = analyzeFirmware({ ...esp, kind: 'full', baseAddress: 0 }, buildEspFlash())
    expect(a.partitions).toHaveLength(6)
    expect(a.bootloader?.chipName).toBe('ESP32')
    expect(a.appOffset).toBe(0x10000)
    expect(a.appDesc?.version).toBe('1.2.3')
    expect(a.encrypted).toBe(false)
    expect(a.usage.used).toBeGreaterThan(0)
    expect(a.usage.used).toBeLessThan(a.usage.total)
  })

  it('полная flash с активным ota_1', () => {
    const a = analyzeFirmware({ ...esp, kind: 'full', baseAddress: 0 }, buildEspFlash({ otadata: loadFixture('esp32-otadata-slot1.bin') }))
    expect(a.appOffset).toBe(0x190000)
  })

  it('только приложение', () => {
    const app = loadFixture('esp32-app.bin')
    const a = analyzeFirmware({ ...esp, kind: 'app', baseAddress: 0x10000 }, app)
    expect(a.partitions).toEqual([])
    expect(a.appOffset).toBe(0x10000)
    expect(a.image?.length).toBe(app.length)
    expect(a.appDesc?.projectName).toBe('pauluk_fixture')
    expect(a.encrypted).toBeNull()
  })

  it('раздел с данными — без паспорта', () => {
    const a = analyzeFirmware({ ...esp, kind: 'partition', baseAddress: 0x9000 }, new Uint8Array(0x4000).fill(0xff))
    expect(a.appDesc).toBeNull()
    expect(a.usage.percent).toBe(0)
  })

  it('Arduino — только занятость по страницам 128 байт', () => {
    const img = parseIntelHex(loadFixtureText('avr-blink.hex'))
    const data = new Uint8Array(0x8000).fill(0xff)
    data.set(img.data)
    const a = analyzeFirmware({ family: 'avr', chip: 'ATmega328P', kind: 'full', baseAddress: 0 }, data)
    expect(a.image).toBeNull()
    expect(a.usage.used % 128).toBe(0)
    expect(a.usage.used).toBeGreaterThanOrEqual(img.data.length - 127)
  })
})
```

`firmware-site/tests/flash/compat.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkCompatibility } from '@/flash/compat'
import { parsePartitionTable } from '@/analysis/partitions'
import type { BoardInfo } from '@/drivers/types'
import { loadFixture } from '../helpers/fixtures'

const parts = parsePartitionTable(loadFixture('esp32-partitions.bin'))
const ota0 = parts.find((p) => p.label === 'ota_0')!
const ota1 = parts.find((p) => p.label === 'ota_1')!
const esp32: BoardInfo = { family: 'esp32', chip: 'ESP32', flashSize: 0x400000, baud: 921600 }
const nano: BoardInfo = { family: 'avr', chip: 'ATmega328P', flashSize: 0x8000, bootloader: 'optiboot', baud: 115200 }
const fw = (o: Partial<Parameters<typeof checkCompatibility>[0]['firmware']> = {}) => ({
  family: 'esp32' as const,
  chip: 'ESP32',
  kind: 'full' as const,
  size: 0x400000,
  ...o,
})

describe('checkCompatibility', () => {
  it('чужой чип — запрет', () => {
    const r = checkCompatibility({ firmware: fw({ chip: 'ESP32-S3' }), board: esp32 })
    expect(r).toEqual({ ok: false, reason: 'Прошивка для ESP32-S3, а подключена ESP32' })
    expect(checkCompatibility({ firmware: fw(), board: nano }).ok).toBe(false)
  })

  it('полный дамп: с адреса 0, не больше flash', () => {
    expect(checkCompatibility({ firmware: fw(), board: esp32 })).toEqual({ ok: true, address: 0, warnings: [] })
    expect(checkCompatibility({ firmware: fw({ size: 0x800000 }), board: esp32 }).ok).toBe(false)
    const smaller = checkCompatibility({ firmware: fw({ size: 0x200000 }), board: esp32 })
    expect(smaller.ok && smaller.warnings[0]).toMatch(/меньше flash платы/)
  })

  it('приложение пишется в активный раздел платы-получателя', () => {
    const r = checkCompatibility({ firmware: fw({ kind: 'app', size: 0x30000 }), board: esp32, partitions: parts, activeApp: ota1 })
    expect(r).toMatchObject({ ok: true, address: 0x190000 })
    expect(checkCompatibility({ firmware: fw({ kind: 'app', size: 0x200000 }), board: esp32, partitions: parts, activeApp: ota0 }).ok).toBe(false)
    expect(checkCompatibility({ firmware: fw({ kind: 'app', size: 10 }), board: esp32, activeApp: null }).ok).toBe(false)
  })

  it('раздел — по имени из таблицы платы', () => {
    expect(checkCompatibility({ firmware: fw({ kind: 'partition', partitionLabel: 'nvs', size: 0x4000 }), board: esp32, partitions: parts })).toMatchObject({ ok: true, address: 0x9000 })
    expect(checkCompatibility({ firmware: fw({ kind: 'partition', partitionLabel: 'нет', size: 1 }), board: esp32, partitions: parts }).ok).toBe(false)
  })

  it('Arduino: с адреса 0, предупреждение про область загрузчика', () => {
    const avr = { family: 'avr' as const, chip: 'ATmega328P', kind: 'full' as const }
    expect(checkCompatibility({ firmware: { ...avr, size: 2000 }, board: nano })).toEqual({ ok: true, address: 0, warnings: [] })
    const full = checkCompatibility({ firmware: { ...avr, size: 0x8000 }, board: nano })
    expect(full.ok && full.warnings[0]).toMatch(/загрузчик/)
  })
})
```

- [ ] **Step 2: Запустить — тесты падают**

Run: `npm test -- tests/analysis/analyze.test.ts tests/flash/compat.test.ts`
Expected: FAIL — `Failed to resolve import "@/analysis/analyze"`.

- [ ] **Step 3: Реализовать анализ**

`firmware-site/src/analysis/analyze.ts`:

```ts
import type { Family } from '@/drivers/types'
import type { DumpKind } from '@/library/db'
import { type AppDesc, parseAppDesc } from './appDesc'
import { bootloaderOffset, ESP_IMAGE_MAGIC, type EspImage, looksEncrypted, parseEspImage } from './espImage'
import { selectAppPartition } from './otadata'
import { isOtaDataPartition, type Partition, PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE, parsePartitionTable } from './partitions'
import { type Usage, usage } from './usage'

export interface FirmwareAnalysis {
  usage: Usage
  bootloader: EspImage | null
  image: EspImage | null
  appDesc: AppDesc | null
  appOffset: number | null // адрес приложения во flash
  partitions: Partition[]
  encrypted: boolean | null
}

export interface AnalysisMeta {
  family: Family
  chip: string
  kind: DumpKind
  baseAddress: number
}

/** Всё, что можно узнать о прошивке без платы, — по байтам и адресу, с которого они считаны. */
export function analyzeFirmware(meta: AnalysisMeta, data: Uint8Array): FirmwareAnalysis {
  const result: FirmwareAnalysis = {
    usage: usage(data, meta.family === 'avr' ? 128 : 4096),
    bootloader: null,
    image: null,
    appDesc: null,
    appOffset: null,
    partitions: [],
    encrypted: null,
  }
  if (meta.family !== 'esp32') return result

  const at = (flashAddress: number) => flashAddress - meta.baseAddress
  const covers = (flashAddress: number, length: number) => at(flashAddress) >= 0 && at(flashAddress) + length <= data.length

  if (covers(PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE)) {
    const start = at(PARTITION_TABLE_OFFSET)
    result.partitions = parsePartitionTable(data.subarray(start, start + PARTITION_TABLE_SIZE))
  }
  result.encrypted = looksEncrypted(data, meta.baseAddress, meta.chip)
  if (covers(bootloaderOffset(meta.chip), 24)) result.bootloader = parseEspImage(data, at(bootloaderOffset(meta.chip)))

  let appAt: number | null = null
  if (result.partitions.length) {
    const ota = result.partitions.find(isOtaDataPartition)
    const otadata = ota && covers(ota.offset, 0x2000) ? data.subarray(at(ota.offset), at(ota.offset) + 0x2000) : null
    const app = selectAppPartition(result.partitions, otadata)
    if (app && covers(app.offset, 1)) appAt = at(app.offset)
  } else if (meta.kind === 'app' || (meta.kind === 'partition' && data[0] === ESP_IMAGE_MAGIC)) {
    appAt = 0
  }
  if (appAt !== null) {
    result.image = parseEspImage(data, appAt)
    result.appDesc = parseAppDesc(data, appAt)
    result.appOffset = meta.baseAddress + appAt
  }
  return result
}
```

- [ ] **Step 4: Реализовать проверку совместимости**

`firmware-site/src/flash/compat.ts`:

```ts
import { formatSize, hexAddr } from '@/analysis/bytes'
import type { Partition } from '@/analysis/partitions'
import { appAreaEnd } from '@/drivers/avr/avrDriver'
import type { BoardInfo, Family } from '@/drivers/types'
import type { DumpKind } from '@/library/db'

export interface CompatInput {
  firmware: { family: Family; chip: string; kind: DumpKind; size: number; partitionLabel?: string }
  board: BoardInfo
  partitions?: Partition[]
  activeApp?: Partition | null
}

export type CompatResult = { ok: true; address: number; warnings: string[] } | { ok: false; reason: string }

const fail = (reason: string): CompatResult => ({ ok: false, reason })

/** Решает, можно ли залить прошивку на подключённую плату и по какому адресу. */
export function checkCompatibility({ firmware, board, partitions = [], activeApp = null }: CompatInput): CompatResult {
  if (firmware.family !== board.family || firmware.chip !== board.chip) {
    return fail(`Прошивка для ${firmware.chip}, а подключена ${board.chip}`)
  }
  if (firmware.size > board.flashSize) {
    return fail(`Прошивка (${formatSize(firmware.size)}) не помещается во flash платы (${formatSize(board.flashSize)})`)
  }
  if (board.family === 'avr') {
    const end = appAreaEnd(board.bootloader ?? 'unknown')
    const warnings = firmware.size > end ? ['Область загрузчика из файла будет пропущена — на плате останется её собственный загрузчик'] : []
    return { ok: true, address: 0, warnings }
  }
  if (firmware.kind === 'full') {
    const warnings =
      firmware.size < board.flashSize
        ? [`Прошивка меньше flash платы: будут перезаписаны первые ${formatSize(firmware.size)}, остальное останется как есть`]
        : []
    return { ok: true, address: 0, warnings }
  }
  if (firmware.kind === 'app') {
    if (!activeApp) return fail('На плате нет раздела для приложения — сначала залейте полный дамп')
    if (firmware.size > activeApp.size) {
      return fail(`Приложение (${formatSize(firmware.size)}) больше раздела ${activeApp.label} (${formatSize(activeApp.size)})`)
    }
    return { ok: true, address: activeApp.offset, warnings: [`Запись в активный раздел ${activeApp.label} (${hexAddr(activeApp.offset)})`] }
  }
  const p = partitions.find((x) => x.label === firmware.partitionLabel)
  if (!p) return fail(`На плате нет раздела «${firmware.partitionLabel ?? '?'}»`)
  if (firmware.size > p.size) return fail(`Дамп (${formatSize(firmware.size)}) больше раздела ${p.label} (${formatSize(p.size)})`)
  return { ok: true, address: p.offset, warnings: [] }
}
```

- [ ] **Step 5: Запустить — тесты проходят**

Run: `npm test`
Expected: PASS (весь набор).

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: анализ прошивки и проверка совместимости перед заливкой"
```

---

### Task 10: Выполнение операций и состояние подключения

**Files:**
- Create: `firmware-site/src/state/progress.ts`
- Create: `firmware-site/src/state/operationRunner.ts`
- Create: `firmware-site/src/state/ConnectionContext.tsx`
- Test: `firmware-site/tests/state/operationRunner.test.ts`, `firmware-site/tests/state/progress.test.ts`

**Interfaces:**
- Consumes: `explainError`, `ExplainedError` (Task 7); `detectBoard` (Task 7); `describePort` (Task 4); `DeviceLostError` (Task 4); `BoardDriver`, `Progress` (Task 4).
- Produces:
  - `etaSeconds(done: number, total: number, startedAt: number, now: number): number | null`, `formatEta(sec: number | null): string`, `percent(done: number, total: number): number`
  - `interface OpState { label: string; done: number; total: number; startedAt: number; cancellable: boolean }`
  - `type RunResult<T> = { ok: true; value: T } | { ok: false; error: ExplainedError }`
  - `class OperationRunner { getState(): OpState | null; subscribe(fn: () => void): () => void; run<T>(label: string, fn: (onProgress: Progress, signal: AbortSignal) => Promise<T>, opts?: { cancellable?: boolean }): Promise<RunResult<T>>; cancel(reason?: unknown): void }`
  - `type ConnStatus = { kind: 'idle' } | { kind: 'detecting'; portLabel: string } | { kind: 'connected'; portLabel: string; driver: BoardDriver } | { kind: 'error'; portLabel?: string; error: ExplainedError }`
  - `ConnectionProvider`, `useConnection(): ConnectionValue` где `ConnectionValue = { supported: boolean; status: ConnStatus; op: OpState | null; log: string[]; hasPort: boolean; choosePort(): Promise<void>; reconnect(): Promise<void>; disconnect(): Promise<void>; run<T>(label, fn: (driver: BoardDriver, onProgress: Progress, signal: AbortSignal) => Promise<T>, opts?): Promise<RunResult<T>>; cancel(): void; clearLog(): void }`

- [ ] **Step 1: Падающие тесты**

`firmware-site/tests/state/progress.test.ts`:

```ts
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
```

`firmware-site/tests/state/operationRunner.test.ts`:

```ts
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

  it('ошибки переводятся в понятный текст', async () => {
    const r = new OperationRunner()
    const res = await r.run('x', async () => {
      throw new Error('Раздел «nvs» не найден')
    })
    expect(res).toMatchObject({ ok: false, error: { title: 'Раздел «nvs» не найден' } })
  })
})
```

- [ ] **Step 2: Запустить — тесты падают**

Run: `npm test -- tests/state`
Expected: FAIL — `Failed to resolve import "@/state/progress"`.

- [ ] **Step 3: Реализовать прогресс и выполнение операций**

`firmware-site/src/state/progress.ts`:

```ts
export function etaSeconds(done: number, total: number, startedAt: number, now: number): number | null {
  if (done <= 0 || total <= 0 || done >= total) return null
  const elapsed = (now - startedAt) / 1000
  if (elapsed < 1) return null
  return Math.round((elapsed / done) * (total - done))
}

export function formatEta(sec: number | null): string {
  if (sec === null) return ''
  if (sec < 60) return `ещё ~${Math.max(1, sec)} с`
  return `ещё ~${Math.round(sec / 60)} мин`
}

export function percent(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0
}
```

`firmware-site/src/state/operationRunner.ts`:

```ts
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
```

- [ ] **Step 4: Запустить — тесты проходят**

Run: `npm test -- tests/state`
Expected: PASS (8 tests).

- [ ] **Step 5: Контекст подключения для интерфейса**

`firmware-site/src/state/ConnectionContext.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { detectBoard } from '@/drivers/detect'
import { DeviceLostError } from '@/drivers/errors'
import { explainError, type ExplainedError } from '@/drivers/explainError'
import type { BoardDriver, Progress } from '@/drivers/types'
import { describePort } from '@/serial/portName'
import { OperationRunner, type OpState, type RunResult } from './operationRunner'

export type ConnStatus =
  | { kind: 'idle' }
  | { kind: 'detecting'; portLabel: string }
  | { kind: 'connected'; portLabel: string; driver: BoardDriver }
  | { kind: 'error'; portLabel?: string; error: ExplainedError }

type DriverOp<T> = (driver: BoardDriver, onProgress: Progress, signal: AbortSignal) => Promise<T>

export interface ConnectionValue {
  /** Браузер умеет Web Serial (Chrome, Edge, Яндекс на компьютере, https или localhost). */
  supported: boolean
  status: ConnStatus
  op: OpState | null
  log: string[]
  hasPort: boolean
  choosePort(): Promise<void>
  reconnect(): Promise<void>
  disconnect(): Promise<void>
  run<T>(label: string, fn: DriverOp<T>, opts?: { cancellable?: boolean }): Promise<RunResult<T>>
  cancel(): void
  clearLog(): void
}

const ConnectionContext = createContext<ConnectionValue | null>(null)

const UNSUPPORTED: ExplainedError = {
  title: 'Этот браузер не умеет работать с COM-портами',
  hint: 'Откройте сайт в Chrome, Edge или Яндекс Браузере на компьютере.',
  raw: 'navigator.serial недоступен',
}

function timestamp(): string {
  return new Date().toLocaleTimeString('ru-RU')
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const supported = typeof navigator !== 'undefined' && 'serial' in navigator && window.isSecureContext
  const [status, setStatus] = useState<ConnStatus>({ kind: 'idle' })
  const [log, setLog] = useState<string[]>([])
  const [hasPort, setHasPort] = useState(false)
  const runner = useMemo(() => new OperationRunner(), [])
  const op = useSyncExternalStore(runner.subscribe, runner.getState)
  const portRef = useRef<SerialPort | null>(null)
  const driverRef = useRef<BoardDriver | null>(null)

  const addLog = useCallback((line: string) => {
    setLog((l) => [...l.slice(-499), `${timestamp()}  ${line}`])
  }, [])

  const connect = useCallback(
    async (port: SerialPort) => {
      const portLabel = describePort(port.getInfo())
      setStatus({ kind: 'detecting', portLabel })
      addLog(`Порт: ${portLabel}`)
      try {
        const driver = await detectBoard(port, addLog)
        driverRef.current = driver
        addLog(`Подключено: ${driver.info.chip}, ${driver.info.baud} бод`)
        setStatus({ kind: 'connected', portLabel, driver })
      } catch (e) {
        const error = explainError(e)
        addLog(`Ошибка: ${error.raw}`)
        setStatus({ kind: 'error', portLabel, error })
      }
    },
    [addLog],
  )

  const disconnect = useCallback(async () => {
    runner.cancel()
    const driver = driverRef.current
    driverRef.current = null
    await driver?.disconnect().catch(() => {})
    setStatus({ kind: 'idle' })
  }, [runner])

  const choosePort = useCallback(async () => {
    if (!supported) {
      setStatus({ kind: 'error', error: UNSUPPORTED })
      return
    }
    let port: SerialPort
    try {
      port = await navigator.serial.requestPort()
    } catch (e) {
      const error = explainError(e)
      if (!error.silent) setStatus({ kind: 'error', error })
      return
    }
    await disconnect()
    portRef.current = port
    setHasPort(true)
    await connect(port)
  }, [supported, connect, disconnect])

  const reconnect = useCallback(async () => {
    const port = portRef.current
    if (!port) return
    await disconnect()
    await connect(port)
  }, [connect, disconnect])

  // Кабель выдернули: операция прерывается, статус — «Кабель отключён».
  useEffect(() => {
    if (!supported) return
    const onDisconnect = (e: Event) => {
      if (e.target !== portRef.current) return
      runner.cancel(new DeviceLostError())
      driverRef.current = null
      portRef.current = null
      setHasPort(false)
      addLog('Кабель отключён')
      setStatus({ kind: 'error', error: explainError(new DeviceLostError()) })
    }
    navigator.serial.addEventListener('disconnect', onDisconnect)
    return () => navigator.serial.removeEventListener('disconnect', onDisconnect)
  }, [supported, runner, addLog])

  // Во время операции браузер переспросит перед закрытием вкладки.
  useEffect(() => {
    if (!op) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [op])

  const run = useCallback(
    async <T,>(label: string, fn: DriverOp<T>, opts?: { cancellable?: boolean }): Promise<RunResult<T>> => {
      const driver = driverRef.current
      if (!driver) {
        return { ok: false, error: { title: 'Плата не подключена', hint: 'Выберите COM-порт на экране «Устройство».', raw: '' } }
      }
      addLog(`${label}…`)
      const result = await runner.run(label, (p, s) => fn(driver, p, s), opts)
      addLog(result.ok ? `${label}: готово` : `${label}: ${result.error.raw || result.error.title}`)
      return result
    },
    [runner, addLog],
  )

  const value: ConnectionValue = {
    supported,
    status,
    op,
    log,
    hasPort,
    choosePort,
    reconnect,
    disconnect,
    run,
    cancel: () => runner.cancel(),
    clearLog: () => setLog([]),
  }
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

export function useConnection(): ConnectionValue {
  const value = useContext(ConnectionContext)
  if (!value) throw new Error('useConnection вне ConnectionProvider')
  return value
}
```

- [ ] **Step 6: Проверить типы**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: без ошибок.

- [ ] **Step 7: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: выполнение операций с прогрессом и контекст подключения"
```

---

### Task 11: Темы Студии, shadcn/ui, каркас с боковым меню

**Files:**
- Create: `firmware-site/components.json`, `firmware-site/src/lib/utils.ts`, `firmware-site/src/components/ui/*` (генерирует shadcn CLI)
- Modify: `firmware-site/src/index.css` (вернуть наш после `shadcn init`, добавить импорт анимаций)
- Create: `firmware-site/src/ui/theme/palettes.ts`, `firmware-site/src/ui/theme/theme.ts`
- Create: `firmware-site/src/ui/routing.ts`
- Create: `firmware-site/src/lib/download.ts`
- Create: `firmware-site/src/ui/components/Panel.tsx`, `StatusDot.tsx`, `StatCard.tsx`, `ErrorCallout.tsx`, `OperationProgress.tsx`, `LogPanel.tsx`
- Create: `firmware-site/src/ui/layout/Sidebar.tsx`, `AppShell.tsx`, `ThemeDialog.tsx`, `UnsupportedBrowser.tsx`
- Create: `firmware-site/src/ui/pages/DevicePage.tsx`, `LibraryPage.tsx`, `AnalysisPage.tsx`, `FlashPage.tsx` (заглушки, наполняются в Task 12–15)
- Modify: `firmware-site/src/App.tsx`, `firmware-site/src/main.tsx`
- Test: `firmware-site/tests/ui/palettes.test.ts`, `firmware-site/tests/ui/routing.test.ts`

**Interfaces:**
- Consumes: `useConnection`, `OpState` (Task 10); `percent`, `etaSeconds`, `formatEta` (Task 10); `formatSize`, `toArrayBuffer` (Task 1); `ExplainedError` (Task 7).
- Produces:
  - `interface Palette { name: string; dark: boolean; bg: string; card: string; fg: string; muted: string; border: string; subtle: string; line: string; accent: string; syntax: [string, string, string] }`
  - `PALETTES: Record<string, Palette>` (15 тем), `SYSTEM_THEME = 'system'`, `SYSTEM_THEME_NAME = 'Как в системе'`
  - `resolvePalette(key: string, prefersDark: boolean): Palette`, `paletteVars(p: Palette): Record<string, string>`
  - `loadThemeKey(): string`, `saveThemeKey(key: string): void`, `applyTheme(key: string): void`, `useTheme(): readonly [string, (key: string) => void]`
  - `type Route = { page: 'device' } | { page: 'library' } | { page: 'analysis'; id: number | null } | { page: 'flash'; id: number | null }`, `parseRoute(hash: string): Route`, `useHashRoute(): Route`
  - `downloadBytes(data: Uint8Array | string, filename: string): void`
  - Компоненты: `Panel({ title?, actions?, className?, children })`, `StatusDot({ tone, pulse?, className? })` + `type Tone = 'ok' | 'warn' | 'err' | 'idle' | 'data'`, `StatCard({ title, value, sub?, children? })`, `UsageBar({ percent })`, `ErrorCallout({ error, tone?, className? })`, `OperationProgress({ className? })`, `LogPanel()`
  - Страницы: `DevicePage()`, `LibraryPage()`, `AnalysisPage({ id })`, `FlashPage({ id })`

- [ ] **Step 1: Подключить shadcn/ui**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику/firmware-site"
npx shadcn@latest init -y -b zinc
```

Если CLI задаёт вопросы — отвечать: базовый цвет **Zinc**, CSS-переменные **да**. CLI перезапишет `src/index.css` — вернуть наш и добавить анимации:

```bash
git checkout -- src/index.css
```

В `src/index.css` второй строкой (после `@import "tailwindcss";`) добавить `@import "tw-animate-css";`. Если пакета `tw-animate-css` нет в `package.json` — `npm install tw-animate-css`.

```bash
npx shadcn@latest add button dialog alert-dialog tabs progress radio-group select input textarea label table -y
```

Expected: файлы в `src/components/ui/`, `src/lib/utils.ts` с функцией `cn`.

- [ ] **Step 2: Падающие тесты тем и маршрутов**

`firmware-site/tests/ui/palettes.test.ts`:

```ts
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
```

`firmware-site/tests/ui/routing.test.ts`:

```ts
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
```

- [ ] **Step 3: Запустить — тесты падают**

Run: `npm test -- tests/ui`
Expected: FAIL — `Failed to resolve import "@/ui/theme/palettes"`.

- [ ] **Step 4: Палитры и применение темы**

`firmware-site/src/ui/theme/palettes.ts`:

```ts
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
```

`firmware-site/src/ui/theme/theme.ts`:

```ts
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
```

`firmware-site/src/ui/routing.ts`:

```ts
import { useEffect, useMemo, useState } from 'react'

export type Route =
  | { page: 'device' }
  | { page: 'library' }
  | { page: 'analysis'; id: number | null }
  | { page: 'flash'; id: number | null }

/** Адреса вида #/analysis/12 — обновление страницы оставляет на том же экране. */
export function parseRoute(hash: string): Route {
  const [, page, rawId] = hash.replace(/^#/, '').split('/')
  const id = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null
  switch (page) {
    case 'library':
      return { page: 'library' }
    case 'analysis':
      return { page: 'analysis', id }
    case 'flash':
      return { page: 'flash', id }
    default:
      return { page: 'device' }
  }
}

export function useHashRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return useMemo(() => parseRoute(hash), [hash])
}
```

- [ ] **Step 5: Запустить — тесты проходят**

Run: `npm test -- tests/ui`
Expected: PASS (4 tests).

- [ ] **Step 6: Общие компоненты**

`firmware-site/src/lib/download.ts`:

```ts
import { toArrayBuffer } from '@/analysis/bytes'

export function downloadBytes(data: Uint8Array | string, filename: string): void {
  const blob =
    typeof data === 'string'
      ? new Blob([data], { type: 'text/plain' })
      : new Blob([toArrayBuffer(data)], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
```

`firmware-site/src/ui/components/Panel.tsx`:

```tsx
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Карточка-виджет Студии: радиус 20, тонкая рамка, почти незаметная тень, глубокая — при наведении. */
export function Panel({ title, actions, className, children }: { title?: string; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        'rounded-[20px] border bg-card p-5 text-card-foreground shadow-[0_1px_2px_rgba(0,0,0,0.10)] transition-shadow duration-200 hover:shadow-[0_14px_28px_-10px_rgba(0,0,0,0.28)]',
        className,
      )}
    >
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}
```

`firmware-site/src/ui/components/StatusDot.tsx`:

```tsx
import { cn } from '@/lib/utils'

export type Tone = 'ok' | 'warn' | 'err' | 'idle' | 'data'

const TONE_CLASS: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err', idle: 'bg-idle', data: 'bg-data' }

export function StatusDot({ tone, pulse = false, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2.5 shrink-0', className)} aria-hidden>
      {pulse && <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', TONE_CLASS[tone])} />}
      <span className={cn('relative inline-flex size-2.5 rounded-full', TONE_CLASS[tone])} />
    </span>
  )
}
```

`firmware-site/src/ui/components/StatCard.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Panel } from './Panel'

/** Мелкий заголовок капсом и крупная цифра — как виджеты статистики в Студии. */
export function StatCard({ title, value, sub, children }: { title: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <Panel title={title}>
      <div className="text-2xl font-medium tracking-tight">{value}</div>
      {children}
      {sub && <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>}
    </Panel>
  )
}

export function UsageBar({ percent }: { percent: number }) {
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-data transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  )
}
```

`firmware-site/src/ui/components/ErrorCallout.tsx`:

```tsx
import type { ExplainedError } from '@/drivers/explainError'
import { cn } from '@/lib/utils'
import { StatusDot } from './StatusDot'

export function ErrorCallout({ error, tone = 'err', className }: { error: Pick<ExplainedError, 'title' | 'hint'>; tone?: 'err' | 'warn'; className?: string }) {
  return (
    <div
      role={tone === 'err' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-[10px] border p-3 text-sm', tone === 'err' ? 'border-err/40 bg-err/5' : 'border-warn/40 bg-warn/5', className)}
    >
      <StatusDot tone={tone} className="mt-1.5" />
      <div className="min-w-0">
        <div className="font-medium break-words">{error.title}</div>
        {error.hint && <div className="mt-0.5 text-muted-foreground">{error.hint}</div>}
      </div>
    </div>
  )
}
```

`firmware-site/src/ui/components/OperationProgress.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatSize } from '@/analysis/bytes'
import { cn } from '@/lib/utils'
import { useConnection } from '@/state/ConnectionContext'
import { etaSeconds, formatEta, percent } from '@/state/progress'

export function OperationProgress({ className }: { className?: string }) {
  const { op, cancel } = useConnection()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!op) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [op])
  if (!op) return null
  const pct = percent(op.done, op.total)
  return (
    <div className={cn('space-y-2', className)} aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{op.label}</span>
        {op.cancellable && (
          <Button size="sm" variant="outline" onClick={cancel}>
            <Square className="size-3.5" /> Стоп
          </Button>
        )}
      </div>
      <Progress value={pct} />
      <div className="text-xs text-muted-foreground">
        {op.total ? `${pct}% · ${formatSize(op.done)} из ${formatSize(op.total)}` : 'Подготовка…'}{' '}
        {formatEta(etaSeconds(op.done, op.total, op.startedAt, now))}
      </div>
    </div>
  )
}
```

`firmware-site/src/ui/components/LogPanel.tsx`:

```tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useConnection } from '@/state/ConnectionContext'

export function LogPanel() {
  const { log, clearLog } = useConnection()
  const [copied, setCopied] = useState(false)
  if (!log.length) return null
  const copy = async () => {
    await navigator.clipboard.writeText(log.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <details className="rounded-[20px] border bg-card p-4 text-sm">
      <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Журнал · {log.length}
      </summary>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          {copied ? 'Скопировано' : 'Копировать'}
        </Button>
        <Button size="sm" variant="ghost" onClick={clearLog}>
          Очистить
        </Button>
      </div>
      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[10px] bg-muted p-3 text-xs">{log.join('\n')}</pre>
    </details>
  )
}
```

- [ ] **Step 7: Боковое меню, окно тем, экран «браузер не подходит», каркас**

`firmware-site/src/ui/layout/Sidebar.tsx`:

```tsx
import { Cpu, FileSearch, Library, Palette, Upload, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type ConnStatus, useConnection } from '@/state/ConnectionContext'
import { StatusDot, type Tone } from '../components/StatusDot'
import type { Route } from '../routing'

const ITEMS: { page: Route['page']; label: string; icon: LucideIcon; href: string }[] = [
  { page: 'device', label: 'Устройство', icon: Cpu, href: '#/device' },
  { page: 'library', label: 'Библиотека', icon: Library, href: '#/library' },
  { page: 'analysis', label: 'Анализ', icon: FileSearch, href: '#/analysis' },
  { page: 'flash', label: 'Заливка', icon: Upload, href: '#/flash' },
]

const itemClass = 'flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors hover:bg-accent'

function statusShort(status: ConnStatus): { tone: Tone; text: string } {
  switch (status.kind) {
    case 'idle': return { tone: 'idle', text: 'Плата не подключена' }
    case 'detecting': return { tone: 'warn', text: 'Определяю плату…' }
    case 'connected': return { tone: 'ok', text: status.driver.info.chip }
    case 'error': return { tone: 'err', text: status.error.title }
  }
}

/** Меню как в Студии: на широком окне — иконки с подписями, уже 900 px — только иконки. */
export function Sidebar({ route, onTheme }: { route: Route; onTheme: () => void }) {
  const { status } = useConnection()
  const short = statusShort(status)
  return (
    <nav className="sticky top-0 flex h-screen w-[72px] shrink-0 flex-col gap-1 border-r bg-card px-2.5 py-3 min-[900px]:w-[276px] min-[900px]:px-3">
      <a href="#/device" className="mb-4 flex items-center gap-3 px-1.5 py-1">
        <img src="/icon.png" alt="" className="size-9 rounded-[10px]" />
        <span className="hidden leading-tight min-[900px]:block">
          <span className="block text-sm font-medium">Прошивки</span>
          <span className="block text-xs text-muted-foreground">Паулюкевичуса</span>
        </span>
      </a>
      {ITEMS.map(({ page, label, icon: Icon, href }) => (
        <a key={page} href={href} title={label} aria-current={route.page === page ? 'page' : undefined}
          className={cn(itemClass, route.page === page && 'bg-accent font-medium')}>
          <Icon className="size-4 shrink-0" />
          <span className="hidden min-[900px]:inline">{label}</span>
        </a>
      ))}
      <div className="mt-auto space-y-1">
        <a href="#/device" title={short.text} className={itemClass}>
          <StatusDot tone={short.tone} pulse={status.kind === 'detecting'} className="mx-[3px]" />
          <span className="hidden truncate text-muted-foreground min-[900px]:inline">{short.text}</span>
        </a>
        <button type="button" onClick={onTheme} title="Тема" className={cn(itemClass, 'w-full')}>
          <Palette className="size-4 shrink-0" />
          <span className="hidden min-[900px]:inline">Тема</span>
        </button>
      </div>
    </nav>
  )
}
```

`firmware-site/src/ui/layout/ThemeDialog.tsx`:

```tsx
import { Check } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { type Palette, PALETTES, SYSTEM_THEME, SYSTEM_THEME_NAME } from '../theme/palettes'
import { useTheme } from '../theme/theme'

function Preview({ pal }: { pal: Palette }) {
  return (
    <div className="space-y-1.5 p-3" style={{ background: pal.bg }}>
      <div className="h-1.5 w-2/3 rounded-full" style={{ background: pal.syntax[0] }} />
      <div className="h-1.5 w-1/2 rounded-full" style={{ background: pal.syntax[1] }} />
      <div className="h-1.5 w-3/4 rounded-full" style={{ background: pal.syntax[2] }} />
      <div className="h-4 rounded-md" style={{ background: pal.card, border: `1px solid ${pal.border}` }} />
    </div>
  )
}

export function ThemeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [current, choose] = useTheme()
  const options = [
    { key: SYSTEM_THEME, name: SYSTEM_THEME_NAME, pal: null as Palette | null },
    ...Object.entries(PALETTES).map(([key, pal]) => ({ key, name: pal.name, pal })),
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[20px] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Тема</DialogTitle>
          <DialogDescription>Как темы редактора в VS Code. Выбор запоминается в этом браузере.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {options.map(({ key, name, pal }) => (
            <button key={key} type="button" onClick={() => choose(key)}
              className={cn('rounded-[14px] border p-2 text-left transition-shadow hover:shadow-md', current === key && 'ring-2 ring-ring')}>
              <div className="overflow-hidden rounded-[10px]">
                {pal ? <Preview pal={pal} /> : (
                  <div className="grid grid-cols-2">
                    <Preview pal={PALETTES.light} />
                    <Preview pal={PALETTES.dark} />
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{name}</span>
                {current === key && <Check className="size-3.5 shrink-0" />}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

`firmware-site/src/ui/layout/UnsupportedBrowser.tsx`:

```tsx
import { Button } from '@/components/ui/button'
import { Panel } from '../components/Panel'

export function UnsupportedBrowser({ onContinue }: { onContinue: () => void }) {
  const insecure = !window.isSecureContext
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Panel className="max-w-lg">
        <img src="/icon.png" alt="" className="mb-4 size-12 rounded-[12px]" />
        <h1 className="text-xl font-medium">Прошивки Паулюкевичуса</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {insecure
            ? 'Сайт открыт по незащищённому адресу. Работать с COM-портами браузер разрешает только по https:// или на localhost.'
            : 'Этот браузер не умеет работать с COM-портами (Web Serial). Откройте сайт в Chrome, Edge или Яндекс Браузере на компьютере — на телефоне, в Firefox и Safari подключить плату нельзя.'}
        </p>
        <Button className="mt-5" variant="outline" onClick={onContinue}>
          Открыть Библиотеку и Анализ без платы
        </Button>
      </Panel>
    </main>
  )
}
```

`firmware-site/src/ui/layout/AppShell.tsx`:

```tsx
import { useState } from 'react'
import { LogPanel } from '../components/LogPanel'
import { AnalysisPage } from '../pages/AnalysisPage'
import { DevicePage } from '../pages/DevicePage'
import { FlashPage } from '../pages/FlashPage'
import { LibraryPage } from '../pages/LibraryPage'
import { useHashRoute } from '../routing'
import { Sidebar } from './Sidebar'
import { ThemeDialog } from './ThemeDialog'

export function AppShell() {
  const route = useHashRoute()
  const [themeOpen, setThemeOpen] = useState(false)
  return (
    <div className="flex min-h-screen">
      <Sidebar route={route} onTheme={() => setThemeOpen(true)} />
      <main className="min-w-0 flex-1 px-4 py-6 min-[900px]:px-8">
        <div className="mx-auto max-w-[1180px] space-y-4">
          {route.page === 'device' && <DevicePage />}
          {route.page === 'library' && <LibraryPage />}
          {route.page === 'analysis' && <AnalysisPage key={route.id ?? 'none'} id={route.id} />}
          {route.page === 'flash' && <FlashPage key={route.id ?? 'none'} id={route.id} />}
          <LogPanel />
        </div>
      </main>
      <ThemeDialog open={themeOpen} onOpenChange={setThemeOpen} />
    </div>
  )
}
```

Заглушки страниц (наполняются в Task 12–15). `firmware-site/src/ui/pages/DevicePage.tsx`:

```tsx
import { Panel } from '../components/Panel'

export function DevicePage() {
  return <Panel title="Устройство">Скоро</Panel>
}
```

`firmware-site/src/ui/pages/LibraryPage.tsx`:

```tsx
import { Panel } from '../components/Panel'

export function LibraryPage() {
  return <Panel title="Библиотека">Скоро</Panel>
}
```

`firmware-site/src/ui/pages/AnalysisPage.tsx`:

```tsx
import { Panel } from '../components/Panel'

export function AnalysisPage({ id }: { id: number | null }) {
  return <Panel title="Анализ">Прошивка {id ?? '—'}</Panel>
}
```

`firmware-site/src/ui/pages/FlashPage.tsx`:

```tsx
import { Panel } from '../components/Panel'

export function FlashPage({ id }: { id: number | null }) {
  return <Panel title="Заливка">Прошивка {id ?? '—'}</Panel>
}
```

`firmware-site/src/App.tsx`:

```tsx
import { useState } from 'react'
import { ConnectionProvider } from '@/state/ConnectionContext'
import { AppShell } from '@/ui/layout/AppShell'
import { UnsupportedBrowser } from '@/ui/layout/UnsupportedBrowser'

export default function App() {
  const supported = 'serial' in navigator && window.isSecureContext
  const [limited, setLimited] = useState(false)
  if (!supported && !limited) return <UnsupportedBrowser onContinue={() => setLimited(true)} />
  return (
    <ConnectionProvider>
      <AppShell />
    </ConnectionProvider>
  )
}
```

`firmware-site/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { applyTheme, loadThemeKey } from './ui/theme/theme'

applyTheme(loadThemeKey()) // до первого кадра, чтобы не мигала светлая тема

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 8: Сборка и тесты**

Run: `npm test && npm run build`
Expected: все тесты PASS, `✓ built`.

- [ ] **Step 9: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: темы Студии, shadcn/ui и каркас с боковым меню"
```

---

### Task 12: Экран «Устройство» — подключение и чтение

**Files:**
- Modify: `firmware-site/src/ui/pages/DevicePage.tsx` (полностью заменить заглушку)

**Interfaces:**
- Consumes: `useConnection`, `ConnStatus` (Task 10); `BoardDriver`, `BoardInfo`, `AppInfo`, `ReadTarget`, `Family` (Task 4); `explainError`, `ExplainedError` (Task 7); `saveFirmware`, `updateFirmware`, `FirmwareRecord` (Task 8); `defaultName` (Task 8); `usage`, `sha256Hex`, `formatSize`, `hexAddr` (Task 1); `formatIntelHex` (Task 2); `parseAppDesc`, `Partition` (Task 3); `downloadBytes`, `Panel`, `StatCard`, `UsageBar`, `StatusDot`, `ErrorCallout`, `OperationProgress` (Task 11).
- Produces: `DevicePage()`.

- [ ] **Step 1: Реализовать экран**

`firmware-site/src/ui/pages/DevicePage.tsx`:

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Download, FileSearch, Info, Plug, RefreshCw, Unplug, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { parseAppDesc } from '@/analysis/appDesc'
import { formatSize, hexAddr } from '@/analysis/bytes'
import { sha256Hex } from '@/analysis/hash'
import { formatIntelHex } from '@/analysis/intelHex'
import type { Partition } from '@/analysis/partitions'
import { type Usage, usage } from '@/analysis/usage'
import { explainError, type ExplainedError } from '@/drivers/explainError'
import type { AppInfo, BoardDriver, BoardInfo, Family, ReadTarget } from '@/drivers/types'
import { downloadBytes } from '@/lib/download'
import { cn } from '@/lib/utils'
import { type FirmwareRecord, saveFirmware, updateFirmware } from '@/library/library'
import { defaultName } from '@/library/naming'
import { type ConnStatus, useConnection } from '@/state/ConnectionContext'
import { ErrorCallout } from '../components/ErrorCallout'
import { OperationProgress } from '../components/OperationProgress'
import { Panel } from '../components/Panel'
import { StatCard, UsageBar } from '../components/StatCard'
import { StatusDot, type Tone } from '../components/StatusDot'

type Mode = 'full' | 'app' | 'partition'

interface ReadOutcome {
  record: FirmwareRecord | null
  name: string
  family: Family
  data: Uint8Array
  eeprom?: Uint8Array
  baseAddress: number
  notes: string[]
  sha256: string
  saveError?: ExplainedError
}

const BOOTLOADER_LABELS = { optiboot: 'Optiboot', atmegaboot: 'старый ATmegaBOOT', unknown: 'неизвестный' } as const

function boardLine(info: BoardInfo): string {
  return [
    info.revision ?? info.chip,
    `${formatSize(info.flashSize)} flash`,
    info.mac && `MAC ${info.mac}`,
    info.bootloader && `загрузчик ${BOOTLOADER_LABELS[info.bootloader]}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function statusView(status: ConnStatus): { tone: Tone; title: string; subtitle: string } {
  switch (status.kind) {
    case 'idle':
      return {
        tone: 'idle',
        title: 'Порт не выбран',
        subtitle: 'Подключите Arduino или ESP32 по USB и нажмите «Выбрать COM-порт». Номер порта (COM5 и т. п.) виден в окне выбора браузера.',
      }
    case 'detecting':
      return { tone: 'warn', title: 'Определяю плату…', subtitle: status.portLabel }
    case 'connected':
      return { tone: 'ok', title: `Подключено · ${status.portLabel} · ${status.driver.info.baud} бод`, subtitle: boardLine(status.driver.info) }
    case 'error':
      return { tone: 'err', title: status.error.title, subtitle: status.portLabel ?? '' }
  }
}

function ModeOption({ value, title, hint, disabled, children }: { value: Mode; title: string; hint: string; disabled?: boolean; children?: ReactNode }) {
  return (
    <div className={cn('flex items-start gap-3', disabled && 'opacity-50')}>
      <RadioGroupItem value={value} id={`mode-${value}`} disabled={disabled} className="mt-1" />
      <div className="min-w-0 flex-1">
        <Label htmlFor={`mode-${value}`} className="font-medium">{title}</Label>
        <div className="text-xs text-muted-foreground">{hint}</div>
        {children}
      </div>
    </div>
  )
}

function AppCard({ info, appInfo }: { info: BoardInfo; appInfo: AppInfo | null }) {
  if (info.family === 'avr') return <StatCard title="Приложение" value="Скетч Arduino" sub="У AVR нет паспорта приложения — тексты из прошивки видны в Анализе" />
  const d = appInfo?.desc
  if (!d) return <StatCard title="Приложение" value="—" sub={appInfo ? `Раздел ${appInfo.partition.label}, паспорт не найден` : 'Паспорт не найден'} />
  return <StatCard title="Приложение" value={<span className="break-all">{d.projectName}</span>} sub={`v${d.version} · собрано ${d.date} ${d.time} · IDF ${d.idfVersion}`} />
}

function ResultPanel({ outcome, onChange }: { outcome: ReadOutcome; onChange: (o: ReadOutcome) => void }) {
  const { record, name, family, data, eeprom, baseAddress, notes, sha256, saveError } = outcome
  return (
    <Panel title="Результат">
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="fw-name">Название</Label>
          <Input
            id="fw-name"
            value={name}
            onChange={(e) => onChange({ ...outcome, name: e.target.value })}
            onBlur={() => record && name.trim() && void updateFirmware(record.id, { name: name.trim() })}
          />
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Размер:</span> {formatSize(data.length)} ·{' '}
          <span className="text-muted-foreground">с адреса</span> {hexAddr(baseAddress)}
          <div className="mt-1 break-all">
            <span className="text-muted-foreground">SHA-256:</span> {sha256}
          </div>
        </div>
        {notes.map((n) => (
          <div key={n} className="flex gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            {n}
          </div>
        ))}
        {record ? (
          <div className="text-sm text-muted-foreground">Сохранено в Библиотеку.</div>
        ) : (
          saveError && <ErrorCallout error={saveError} tone="warn" />
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => downloadBytes(data, `${name}.bin`)}>
            <Download className="size-4" /> Скачать .bin
          </Button>
          {family === 'avr' && (
            <Button variant="outline" onClick={() => downloadBytes(formatIntelHex(data, baseAddress), `${name}.hex`)}>
              Скачать .hex
            </Button>
          )}
          {eeprom && (
            <Button variant="outline" onClick={() => downloadBytes(eeprom, `${name}_eeprom.bin`)}>
              Скачать EEPROM
            </Button>
          )}
          {record && (
            <Button variant="outline" asChild>
              <a href={`#/analysis/${record.id}`}>
                <FileSearch className="size-4" /> Открыть анализ
              </a>
            </Button>
          )}
          {record && (
            <Button variant="ghost" asChild>
              <a href={`#/flash/${record.id}`}>
                <Upload className="size-4" /> Залить на другую плату
              </a>
            </Button>
          )}
        </div>
      </div>
    </Panel>
  )
}

export function DevicePage() {
  const { status, op, supported, hasPort, choosePort, reconnect, disconnect, run } = useConnection()
  const driver = status.kind === 'connected' ? status.driver : null
  const info = driver?.info ?? null
  const currentDriver = useRef<BoardDriver | null>(null)
  currentDriver.current = driver
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [partitions, setPartitions] = useState<Partition[]>([])
  const [mode, setMode] = useState<Mode>('full')
  const [partitionLabel, setPartitionLabel] = useState('')
  const [fullUsage, setFullUsage] = useState<Usage | null>(null)
  const [outcome, setOutcome] = useState<ReadOutcome | null>(null)
  const [error, setError] = useState<ExplainedError | null>(null)

  // Новая плата: сбросить прошлые результаты; у ESP32 — прочитать разделы и паспорт приложения.
  useEffect(() => {
    setAppInfo(null)
    setPartitions([])
    setFullUsage(null)
    setOutcome(null)
    setError(null)
    setMode('full')
    if (!driver || driver.info.family !== 'esp32') return
    void run(
      'Читаю таблицу разделов',
      async (d) => ({ parts: (await d.readPartitionTable?.()) ?? [], app: (await d.appInfo?.()) ?? null }),
      { cancellable: false },
    ).then((r) => {
      // Пустая или зашифрованная flash — не ошибка: просто нет паспорта и разделов.
      // Повторный вызов эффекта в StrictMode получит «уже идёт операция» — его результат не нужен.
      if (currentDriver.current !== driver || !r.ok) return
      setPartitions(r.value.parts)
      setAppInfo(r.value.app)
      setPartitionLabel(r.value.parts[0]?.label ?? '')
    })
  }, [driver, run])

  async function onRead() {
    if (!info) return
    setError(null)
    setOutcome(null)
    const target: ReadTarget = mode === 'partition' ? { kind: 'partition', label: partitionLabel } : { kind: mode }
    const r = await run('Чтение прошивки', (d, p, s) => d.read(target, p, s))
    if (!r.ok) {
      if (!r.error.silent) setError(r.error)
      return
    }
    const read = r.value
    if (target.kind === 'full') setFullUsage(usage(read.data, info.family === 'avr' ? 128 : 4096))
    const desc = target.kind === 'partition' ? null : ((target.kind === 'app' ? parseAppDesc(read.data, 0) : null) ?? appInfo?.desc ?? null)
    const name = defaultName(info.chip, target.kind === 'partition' ? target.label : desc?.projectName, new Date())
    const sha256 = await sha256Hex(read.data)
    let record: FirmwareRecord | null = null
    let saveError: ExplainedError | undefined
    try {
      record = await saveFirmware({
        name,
        family: info.family,
        chip: info.chip,
        kind: target.kind,
        partitionLabel: read.partitionLabel,
        baseAddress: read.baseAddress,
        data: read.data,
        eeprom: read.eeprom,
        source: 'board',
        appName: desc?.projectName,
        appVersion: desc?.version,
      })
    } catch (e) {
      saveError = explainError(e)
    }
    setOutcome({ record, name, family: info.family, data: read.data, eeprom: read.eeprom, baseAddress: read.baseAddress, notes: read.notes, sha256, saveError })
  }

  const view = statusView(status)
  const busy = op !== null || status.kind === 'detecting'

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-medium">Устройство</h1>
      <Panel title="Подключение">
        <div className="flex flex-wrap items-start gap-3">
          <StatusDot tone={view.tone} pulse={status.kind === 'detecting'} className="mt-1.5" />
          <div className="min-w-0 flex-1">
            <div className="font-medium break-words">{view.title}</div>
            {view.subtitle && <div className="mt-0.5 text-sm break-words text-muted-foreground">{view.subtitle}</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            {status.kind === 'connected' ? (
              <>
                <Button variant="outline" onClick={() => void disconnect()} disabled={busy}>
                  <Unplug className="size-4" /> Отключить
                </Button>
                <Button variant="ghost" onClick={() => void choosePort()} disabled={busy}>
                  Сменить порт
                </Button>
              </>
            ) : (
              <>
                {status.kind === 'error' && hasPort && (
                  <Button variant="outline" onClick={() => void reconnect()} disabled={busy}>
                    <RefreshCw className="size-4" /> Повторить
                  </Button>
                )}
                <Button onClick={() => void choosePort()} disabled={busy || !supported}>
                  <Plug className="size-4" /> Выбрать COM-порт
                </Button>
              </>
            )}
          </div>
        </div>
        {status.kind === 'error' && status.error.hint && (
          <ErrorCallout error={{ title: 'Что сделать', hint: status.error.hint }} tone="warn" className="mt-4" />
        )}
        {!supported && (
          <ErrorCallout
            error={{ title: 'Этот браузер не умеет работать с COM-портами', hint: 'Откройте сайт в Chrome, Edge или Яндекс Браузере на компьютере.' }}
            tone="warn"
            className="mt-4"
          />
        )}
      </Panel>

      {info && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard title="Занято" value={fullUsage ? formatSize(fullUsage.used) : '—'} sub={fullUsage ? `${fullUsage.percent}% flash` : 'Считайте всю flash, чтобы узнать'}>
              {fullUsage && <UsageBar percent={fullUsage.percent} />}
            </StatCard>
            <AppCard info={info} appInfo={appInfo} />
            <StatCard title="Свободно" value={fullUsage ? formatSize(fullUsage.free) : '—'} sub={`из ${formatSize(info.flashSize)}`} />
          </div>

          <Panel title="Считать">
            {info.family === 'esp32' ? (
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="gap-3">
                <ModeOption value="full" title="Вся flash" hint={`Точный клон: загрузчик, приложение, настройки Wi-Fi и файлы · ${formatSize(info.flashSize)}`} />
                <ModeOption
                  value="app"
                  title="Только приложение"
                  hint={appInfo ? `Раздел ${appInfo.partition.label} · быстрее, файл меньше` : 'Недоступно: на плате не найден раздел приложения'}
                  disabled={!appInfo}
                />
                <ModeOption value="partition" title="Один раздел" hint="NVS, SPIFFS, LittleFS и т. п." disabled={!partitions.length}>
                  {mode === 'partition' && (
                    <Select value={partitionLabel} onValueChange={setPartitionLabel}>
                      <SelectTrigger className="mt-2 w-full sm:w-80">
                        <SelectValue placeholder="Раздел" />
                      </SelectTrigger>
                      <SelectContent>
                        {partitions.map((p) => (
                          <SelectItem key={p.label} value={p.label}>
                            {p.label} · {p.subtypeName} · {formatSize(p.size)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </ModeOption>
              </RadioGroup>
            ) : (
              <p className="text-sm text-muted-foreground">У Arduino считывается вся flash — 32 КБ вместе с загрузчиком.</p>
            )}
            <div className="mt-4">
              <Button onClick={() => void onRead()} disabled={busy}>
                <Download className="size-4" /> Считать
              </Button>
            </div>
            <OperationProgress className="mt-4" />
            {error && <ErrorCallout error={error} className="mt-4" />}
          </Panel>
        </>
      )}

      {outcome && <ResultPanel outcome={outcome} onChange={setOutcome} />}
    </div>
  )
}
```

- [ ] **Step 2: Сборка**

Run: `npm run build`
Expected: `✓ built`, без ошибок TypeScript.

- [ ] **Step 3: Проверить в браузере без платы**

Запустить `npm run dev`, открыть `http://localhost:5173` в Chrome. Expected: экран «Устройство», серая точка «Порт не выбран», кнопка «Выбрать COM-порт». Нажать её и закрыть окно выбора — ошибки на странице нет (отмена молчаливая).

- [ ] **Step 4: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: экран «Устройство» — подключение, чтение и скачивание"
```

---

### Task 13: Экран «Библиотека» и загрузка файлов

**Files:**
- Create: `firmware-site/src/ui/library/ImportButton.tsx`
- Create: `firmware-site/src/ui/library/downloadRecord.ts`
- Modify: `firmware-site/src/ui/pages/LibraryPage.tsx` (полностью заменить заглушку)

**Interfaces:**
- Consumes: `listFirmware`, `saveFirmware`, `updateFirmware`, `deleteFirmware`, `getFirmwareData`, `storageEstimate`, `kindLabel`, `FirmwareRecord` (Task 8); `identifyFile`, `IdentifiedFile`, `MANUAL_CHIPS` (Task 8); `formatIntelHex` (Task 2); `formatSize` (Task 1); `explainError` (Task 7); `downloadBytes`, `Panel`, `ErrorCallout` (Task 11); `useLiveQuery` из `dexie-react-hooks`.
- Produces:
  - `ImportButton({ onImported?: (rec: FirmwareRecord) => void })` — кнопка «Загрузить файл», выбор чипа для неопознанных файлов, сохранение в библиотеку
  - `downloadRecord(rec: FirmwareRecord, format: 'bin' | 'hex' | 'eeprom'): Promise<void>`
  - `formatDate(ts: number): string`
  - `LibraryPage()`

- [ ] **Step 1: Скачивание записи и кнопка импорта**

`firmware-site/src/ui/library/downloadRecord.ts`:

```ts
import { formatIntelHex } from '@/analysis/intelHex'
import { downloadBytes } from '@/lib/download'
import { type FirmwareRecord, getFirmwareData } from '@/library/library'

export async function downloadRecord(rec: FirmwareRecord, format: 'bin' | 'hex' | 'eeprom'): Promise<void> {
  const blob = await getFirmwareData(rec.id)
  if (!blob) return
  if (format === 'hex') downloadBytes(formatIntelHex(blob.data, rec.baseAddress), `${rec.name}.hex`)
  else if (format === 'eeprom') {
    if (blob.eeprom) downloadBytes(blob.eeprom, `${rec.name}_eeprom.bin`)
  } else downloadBytes(blob.data, `${rec.name}.bin`)
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}
```

`firmware-site/src/ui/library/ImportButton.tsx`:

```tsx
import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { explainError, type ExplainedError } from '@/drivers/explainError'
import type { Family } from '@/drivers/types'
import { type IdentifiedFile, identifyFile, MANUAL_CHIPS } from '@/library/identify'
import { type FirmwareRecord, saveFirmware } from '@/library/library'
import { ErrorCallout } from '../components/ErrorCallout'

const chipTitle = (chip: string) => (chip === 'ATmega328P' ? 'Arduino Uno / Nano / Pro Mini (ATmega328P)' : chip)

export function ImportButton({ onImported }: { onImported?: (rec: FirmwareRecord) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<IdentifiedFile | null>(null)
  const [chip, setChip] = useState(MANUAL_CHIPS[0].chip)
  const [error, setError] = useState<ExplainedError | null>(null)

  async function save(f: IdentifiedFile, family: Family, chipName: string) {
    try {
      const rec = await saveFirmware({
        name: f.name,
        family,
        chip: chipName,
        kind: f.kind,
        baseAddress: f.baseAddress,
        data: f.data,
        source: 'file',
        appName: f.appName,
        appVersion: f.appVersion,
      })
      onImported?.(rec)
    } catch (e) {
      setError(explainError(e))
    }
  }

  async function onFile(file: File) {
    setError(null)
    try {
      const f = identifyFile(file.name, new Uint8Array(await file.arrayBuffer()))
      if (f.family && f.chip) await save(f, f.family, f.chip)
      else setPending(f)
    } catch (e) {
      setError(explainError(e))
    }
  }

  async function confirmChip() {
    const f = pending
    const choice = MANUAL_CHIPS.find((c) => c.chip === chip)
    setPending(null)
    if (f && choice) await save(f, choice.family, choice.chip)
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".bin,.hex"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void onFile(file)
        }}
      />
      <Button variant="outline" onClick={() => inputRef.current?.click()}>
        <FileUp className="size-4" /> Загрузить файл
      </Button>
      {error && <ErrorCallout error={error} />}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="rounded-[20px]">
          <DialogHeader>
            <DialogTitle>Для какой платы этот файл?</DialogTitle>
            <DialogDescription>
              По содержимому «{pending?.name}» чип не определить. От выбора зависит, на какие платы файл можно будет залить.
            </DialogDescription>
          </DialogHeader>
          <Select value={chip} onValueChange={setChip}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MANUAL_CHIPS.map((c) => (
                <SelectItem key={c.chip} value={c.chip}>
                  {chipTitle(c.chip)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Отмена
            </Button>
            <Button onClick={() => void confirmChip()}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Экран библиотеки**

`firmware-site/src/ui/pages/LibraryPage.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, FileSearch, Pencil, Trash2, Upload } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { formatSize } from '@/analysis/bytes'
import { deleteFirmware, type FirmwareRecord, kindLabel, listFirmware, storageEstimate, updateFirmware } from '@/library/library'
import { Panel } from '../components/Panel'
import { downloadRecord, formatDate } from '../library/downloadRecord'
import { ImportButton } from '../library/ImportButton'

function EditDialog({ record, onClose }: { record: FirmwareRecord | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => {
    if (record) {
      setName(record.name)
      setNote(record.note)
    }
  }, [record])
  async function save() {
    if (!record) return
    await updateFirmware(record.id, { name: name.trim() || record.name, note })
    onClose()
  }
  return (
    <Dialog open={record !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-[20px]">
        <DialogHeader>
          <DialogTitle>Название и заметка</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-name">Название</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-note">Заметка</Label>
            <Textarea id="edit-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: котёл на даче, до обновления" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={() => void save()}>Сохранить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function IconLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <Button variant="ghost" size="icon" asChild>
      <a href={href} title={label} aria-label={label}>{children}</a>
    </Button>
  )
}

export function LibraryPage() {
  const records = useLiveQuery(listFirmware, [], [] as FirmwareRecord[])
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  const [editing, setEditing] = useState<FirmwareRecord | null>(null)
  const [deleting, setDeleting] = useState<FirmwareRecord | null>(null)

  useEffect(() => {
    void storageEstimate().then(setEstimate)
  }, [records])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-medium">Библиотека</h1>
        <ImportButton />
      </div>
      <Panel title={`Прошивки · ${records.length}`}>
        {records.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Здесь появятся считанные прошивки. Считайте плату на экране «Устройство» или загрузите файл .bin / .hex.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Чип</TableHead>
                <TableHead className="hidden md:table-cell">Тип</TableHead>
                <TableHead className="hidden md:table-cell">Размер</TableHead>
                <TableHead className="hidden lg:table-cell">Дата</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[260px]">
                    <div className="truncate font-medium" title={r.name}>{r.name}</div>
                    {r.note && <div className="truncate text-xs text-muted-foreground" title={r.note}>{r.note}</div>}
                  </TableCell>
                  <TableCell>{r.chip}</TableCell>
                  <TableCell className="hidden md:table-cell">{kindLabel(r)}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatSize(r.size)}</TableCell>
                  <TableCell className="hidden lg:table-cell">{formatDate(r.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon" title="Скачать .bin" aria-label="Скачать .bin" onClick={() => void downloadRecord(r, 'bin')}>
                        <Download className="size-4" />
                      </Button>
                      {r.family === 'avr' && (
                        <Button variant="ghost" size="sm" title="Скачать .hex" onClick={() => void downloadRecord(r, 'hex')}>
                          HEX
                        </Button>
                      )}
                      <IconLink href={`#/analysis/${r.id}`} label="Анализ"><FileSearch className="size-4" /></IconLink>
                      <IconLink href={`#/flash/${r.id}`} label="Залить"><Upload className="size-4" /></IconLink>
                      <Button variant="ghost" size="icon" title="Название и заметка" aria-label="Название и заметка" onClick={() => setEditing(r)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Удалить" aria-label="Удалить" onClick={() => setDeleting(r)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      {estimate && (
        <p className="text-xs text-muted-foreground">
          В браузере занято {formatSize(estimate.usage)} из {formatSize(estimate.quota)}. Прошивки хранятся только в этом браузере и никуда не отправляются.
        </p>
      )}
      <EditDialog record={editing} onClose={() => setEditing(null)} />
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить «{deleting?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>Прошивка исчезнет из Библиотеки этого браузера. Скачанные файлы останутся.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && void deleteFirmware(deleting.id)}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

- [ ] **Step 3: Сборка**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 4: Проверить в браузере**

`npm run dev`, открыть `http://localhost:5173/#/library`. Нажать «Загрузить файл» и выбрать `firmware-site/tests/fixtures/avr-blink.hex`. Expected: строка «avr-blink · ATmega328P · Вся flash». Загрузить любой не-HEX `.bin` без заголовка ESP (например, `firmware-site/public/icon.png`, переименованный в копии в `x.bin`) — появляется окно выбора чипа. Кнопки «Скачать», «HEX», «Удалить» работают.

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: экран «Библиотека» и загрузка прошивок с диска"
```

---

### Task 14: Экран «Анализ» — сводка, разделы, строки, HEX

**Files:**
- Create: `firmware-site/src/ui/analysis/SummaryTab.tsx`
- Create: `firmware-site/src/ui/analysis/PartitionsTab.tsx`
- Create: `firmware-site/src/ui/analysis/StringsTab.tsx`
- Create: `firmware-site/src/ui/analysis/HexView.tsx`
- Modify: `firmware-site/src/ui/pages/AnalysisPage.tsx` (полностью заменить заглушку)

**Interfaces:**
- Consumes: `analyzeFirmware`, `FirmwareAnalysis` (Task 9); `extractStrings` (Task 2); `Partition` (Task 3); `formatSize`, `hexAddr` (Task 1); `listFirmware`, `getFirmware`, `getFirmwareData`, `kindLabel`, `FirmwareRecord` (Task 8); `downloadRecord`, `formatDate` (Task 13); `Panel`, `StatCard`, `UsageBar`, `ErrorCallout` (Task 11); `useVirtualizer` из `@tanstack/react-virtual`.
- Produces: `AnalysisPage({ id })`, `HexView({ data, baseAddress, highlight })`, `StringsTab({ data, baseAddress, onJump })`, `PartitionsTab({ partitions, flashSize })`, `SummaryTab({ record, analysis })`.

- [ ] **Step 1: Сводка**

`firmware-site/src/ui/analysis/SummaryTab.tsx`:

```tsx
import type { FirmwareAnalysis } from '@/analysis/analyze'
import { formatSize, hexAddr } from '@/analysis/bytes'
import type { FirmwareRecord } from '@/library/library'
import { ErrorCallout } from '../components/ErrorCallout'
import { Panel } from '../components/Panel'
import { StatCard, UsageBar } from '../components/StatCard'
import { formatDate } from '../library/downloadRecord'

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="break-all">{v}</dd>
    </>
  )
}

export function SummaryTab({ record, analysis }: { record: FirmwareRecord; analysis: FirmwareAnalysis }) {
  const { usage: u, appDesc, bootloader, encrypted, appOffset, image } = analysis
  return (
    <div className="space-y-4">
      {encrypted && (
        <ErrorCallout
          tone="warn"
          error={{
            title: 'Похоже, flash зашифрована',
            hint: 'Дамп годится как резервная копия этой же платы, но на другой плате работать не будет; паспорт и строки не читаются.',
          }}
        />
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="Занято" value={formatSize(u.used)} sub={`${u.percent}% из ${formatSize(u.total)}`}>
          <UsageBar percent={u.percent} />
        </StatCard>
        <StatCard
          title="Чип"
          value={record.chip}
          sub={bootloader?.flashSizeBytes ? `загрузчик настроен на ${formatSize(bootloader.flashSizeBytes)} flash` : record.source === 'board' ? 'считано с платы' : 'загружено из файла'}
        />
        <StatCard title="Сохранено" value={formatDate(record.createdAt)} sub={record.note || (record.hasEeprom ? 'вместе с EEPROM' : undefined)} />
      </div>
      <Panel title="Контрольная сумма">
        <div className="break-all text-sm">SHA-256: {record.sha256}</div>
        <p className="mt-1 text-xs text-muted-foreground">Если у двух файлов суммы совпадают — прошивки одинаковые байт в байт.</p>
      </Panel>
      {record.family === 'esp32' && (
        <Panel title="Паспорт приложения">
          {appDesc ? (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
              <Row k="Проект" v={appDesc.projectName} />
              <Row k="Версия" v={appDesc.version} />
              <Row k="Собрано" v={`${appDesc.date} ${appDesc.time}`} />
              <Row k="ESP-IDF" v={appDesc.idfVersion} />
              {appOffset !== null && <Row k="Адрес" v={hexAddr(appOffset)} />}
              {image && <Row k="Размер образа" v={formatSize(image.length)} />}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Паспорт приложения в этом дампе не найден.</p>
          )}
        </Panel>
      )}
      <Panel title="Почему здесь нет исходного кода">
        <p className="text-sm text-muted-foreground">
          При компиляции скетч превращается в машинные инструкции: имена переменных, комментарии и структура программы исчезают.
          Поэтому из платы нельзя получить .ino или .cpp — только бинарный код. Что можно узнать:{' '}
          {record.family === 'esp32' ? 'паспорт приложения, разделы, ' : ''}текстовые строки (сообщения Serial.print, имена Wi-Fi-сетей,
          адреса серверов) и сами байты во вкладке HEX.
        </p>
      </Panel>
    </div>
  )
}
```

- [ ] **Step 2: Разделы с картой flash**

`firmware-site/src/ui/analysis/PartitionsTab.tsx`:

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatSize, hexAddr } from '@/analysis/bytes'
import type { Partition } from '@/analysis/partitions'
import { Panel } from '../components/Panel'

const COLORS = ['var(--data)', 'var(--ok)', 'var(--warn)', '#8B5CF6', 'var(--err)', 'var(--idle)']
const color = (i: number) => COLORS[i % COLORS.length]

export function PartitionsTab({ partitions, flashSize }: { partitions: Partition[]; flashSize: number }) {
  return (
    <Panel title="Разделы flash">
      <div className="relative h-6 w-full overflow-hidden rounded-[8px] border bg-muted" role="img" aria-label="Карта flash">
        {partitions.map((p, i) => (
          <div
            key={p.label}
            className="absolute top-0 h-full border-r border-background/60"
            title={`${p.label} · ${hexAddr(p.offset)} · ${formatSize(p.size)}`}
            style={{ left: `${(p.offset / flashSize) * 100}%`, width: `${Math.max((p.size / flashSize) * 100, 0.4)}%`, background: color(i) }}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {partitions.map((p, i) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: color(i) }} />
            {p.label}
          </span>
        ))}
      </div>
      <Table className="mt-4">
        <TableHeader>
          <TableRow>
            <TableHead>Раздел</TableHead>
            <TableHead>Тип</TableHead>
            <TableHead>Адрес</TableHead>
            <TableHead>Размер</TableHead>
            <TableHead className="hidden sm:table-cell">Шифрование</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {partitions.map((p) => (
            <TableRow key={p.label}>
              <TableCell className="font-medium">{p.label}</TableCell>
              <TableCell>{p.typeName} / {p.subtypeName}</TableCell>
              <TableCell>{hexAddr(p.offset)}</TableCell>
              <TableCell>{formatSize(p.size)}</TableCell>
              <TableCell className="hidden sm:table-cell">{p.encrypted ? 'да' : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  )
}
```

- [ ] **Step 3: Строки и HEX**

`firmware-site/src/ui/analysis/StringsTab.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { hexAddr } from '@/analysis/bytes'
import { extractStrings } from '@/analysis/strings'
import { Panel } from '../components/Panel'

const SHOW_LIMIT = 1000

export function StringsTab({ data, baseAddress, onJump }: { data: Uint8Array; baseAddress: number; onJump: (address: number, length: number) => void }) {
  const all = useMemo(() => extractStrings(data, baseAddress), [data, baseAddress])
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? all.filter((s) => s.text.toLowerCase().includes(q)) : all
  }, [all, query])
  const encoder = useMemo(() => new TextEncoder(), [])
  return (
    <Panel title={`Строки · ${all.length}`}>
      <div className="flex flex-wrap gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск: ssid, http, версия…" className="sm:max-w-sm" />
        <Button variant="outline" onClick={() => void navigator.clipboard.writeText(filtered.map((s) => s.text).join('\n'))}>
          <Copy className="size-4" /> Копировать
        </Button>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {filtered.length > SHOW_LIMIT ? `Показаны первые ${SHOW_LIMIT} из ${filtered.length} — уточните поиск` : `Найдено: ${filtered.length}`}
      </div>
      <ul className="mt-2 max-h-[60vh] divide-y overflow-auto rounded-[10px] border text-sm">
        {filtered.slice(0, SHOW_LIMIT).map((s) => (
          <li key={s.address} className="flex gap-3 px-3 py-1.5">
            <button
              type="button"
              className="shrink-0 font-mono text-xs text-data hover:underline"
              title="Показать в HEX"
              onClick={() => onJump(s.address, encoder.encode(s.text).length)}
            >
              {hexAddr(s.address)}
            </button>
            <span className="min-w-0 break-all">{s.text}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
```

`firmware-site/src/ui/analysis/HexView.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { hexAddr } from '@/analysis/bytes'

const hex2 = (b: number) => b.toString(16).toUpperCase().padStart(2, '0')
const ascii = (b: number) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·')

/** Виртуальная прокрутка: в DOM только видимые строки, поэтому 16 МБ открываются мгновенно. */
export function HexView({ data, baseAddress, highlight }: { data: Uint8Array; baseAddress: number; highlight: { address: number; length: number } | null }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const rows = Math.ceil(data.length / 16)
  const virtualizer = useVirtualizer({ count: rows, getScrollElement: () => parentRef.current, estimateSize: () => 24, overscan: 20 })
  const [target, setTarget] = useState('')
  const [targetError, setTargetError] = useState('')

  useEffect(() => {
    if (highlight) virtualizer.scrollToIndex(Math.floor((highlight.address - baseAddress) / 16), { align: 'center' })
  }, [highlight, baseAddress, virtualizer])

  function jump() {
    const n = parseInt(target.trim().replace(/^0x/i, ''), 16)
    const row = Math.floor((n - baseAddress) / 16)
    if (Number.isNaN(n) || row < 0 || row >= rows) {
      setTargetError(`Адрес вне дампа: ${hexAddr(baseAddress)} … ${hexAddr(baseAddress + data.length - 1)}`)
      return
    }
    setTargetError('')
    virtualizer.scrollToIndex(row, { align: 'start' })
  }

  const hiStart = highlight ? highlight.address - baseAddress : -1
  const hiEnd = highlight ? hiStart + highlight.length : -1

  return (
    <div>
      <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); jump() }}>
        <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Адрес, например 0x8000" className="sm:max-w-xs" />
        <Button type="submit" variant="outline">Перейти</Button>
      </form>
      {targetError && <div className="mb-2 text-xs text-err">{targetError}</div>}
      <div ref={parentRef} className="h-[60vh] overflow-auto rounded-[10px] border font-mono text-xs">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const off = item.index * 16
            const bytes = data.subarray(off, off + 16)
            return (
              <div key={item.key} className="absolute left-0 top-0 flex w-full gap-4 px-3 leading-6 whitespace-pre" style={{ transform: `translateY(${item.start}px)` }}>
                <span className="text-muted-foreground">{hexAddr(baseAddress + off)}</span>
                <span>
                  {Array.from(bytes, (b, i) => (
                    <span key={i} className={off + i >= hiStart && off + i < hiEnd ? 'rounded-sm bg-data/25' : undefined}>
                      {hex2(b)}{i === 7 ? '  ' : ' '}
                    </span>
                  ))}
                </span>
                <span className="hidden text-muted-foreground sm:inline">{Array.from(bytes, ascii).join('')}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Экран анализа**

`firmware-site/src/ui/pages/AnalysisPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { analyzeFirmware } from '@/analysis/analyze'
import { formatSize, hexAddr } from '@/analysis/bytes'
import { type FirmwareRecord, getFirmware, getFirmwareData, kindLabel, listFirmware } from '@/library/library'
import { HexView } from '../analysis/HexView'
import { PartitionsTab } from '../analysis/PartitionsTab'
import { StringsTab } from '../analysis/StringsTab'
import { SummaryTab } from '../analysis/SummaryTab'
import { Panel } from '../components/Panel'
import { downloadRecord, formatDate } from '../library/downloadRecord'

type Loaded = { record: FirmwareRecord; data: Uint8Array } | 'missing' | null

function Picker() {
  const records = useLiveQuery(listFirmware, [], [] as FirmwareRecord[])
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-medium">Анализ</h1>
      <Panel title="Выберите прошивку">
        {records.length === 0 ? (
          <p className="text-sm text-muted-foreground">Библиотека пуста. Считайте плату на экране «Устройство» или загрузите файл в «Библиотеке».</p>
        ) : (
          <ul className="divide-y">
            {records.map((r) => (
              <li key={r.id}>
                <a href={`#/analysis/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:text-primary">
                  <span className="font-medium break-all">{r.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.chip} · {kindLabel(r)} · {formatSize(r.size)} · {formatDate(r.createdAt)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function AnalysisView({ record, data }: { record: FirmwareRecord; data: Uint8Array }) {
  const analysis = useMemo(() => analyzeFirmware(record, data), [record, data])
  const [tab, setTab] = useState('summary')
  const [highlight, setHighlight] = useState<{ address: number; length: number } | null>(null)
  const flashSize =
    analysis.bootloader?.flashSizeBytes ??
    Math.max(record.baseAddress + record.size, ...analysis.partitions.map((p) => p.offset + p.size))
  const jump = (address: number, length: number) => {
    setHighlight({ address, length })
    setTab('hex')
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-medium break-all">{record.name}</h1>
          <div className="text-sm text-muted-foreground">
            {record.chip} · {kindLabel(record)} · {formatSize(record.size)} · с адреса {hexAddr(record.baseAddress)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void downloadRecord(record, 'bin')}>
            <Download className="size-4" /> .bin
          </Button>
          {record.family === 'avr' && (
            <Button variant="outline" onClick={() => void downloadRecord(record, 'hex')}>.hex</Button>
          )}
          <Button asChild>
            <a href={`#/flash/${record.id}`}>
              <Upload className="size-4" /> Залить
            </a>
          </Button>
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="summary">Сводка</TabsTrigger>
          {analysis.partitions.length > 0 && <TabsTrigger value="partitions">Разделы</TabsTrigger>}
          <TabsTrigger value="strings">Строки</TabsTrigger>
          <TabsTrigger value="hex">HEX</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="mt-4">
          <SummaryTab record={record} analysis={analysis} />
        </TabsContent>
        {analysis.partitions.length > 0 && (
          <TabsContent value="partitions" className="mt-4">
            <PartitionsTab partitions={analysis.partitions} flashSize={flashSize} />
          </TabsContent>
        )}
        <TabsContent value="strings" className="mt-4">
          <StringsTab data={data} baseAddress={record.baseAddress} onJump={jump} />
        </TabsContent>
        <TabsContent value="hex" className="mt-4">
          <Panel title="HEX">
            <HexView data={data} baseAddress={record.baseAddress} highlight={highlight} />
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function AnalysisPage({ id }: { id: number | null }) {
  const [loaded, setLoaded] = useState<Loaded>(null)
  useEffect(() => {
    if (id === null) return
    let active = true
    void Promise.all([getFirmware(id), getFirmwareData(id)]).then(([record, blob]) => {
      if (active) setLoaded(record && blob ? { record, data: blob.data } : 'missing')
    })
    return () => {
      active = false
    }
  }, [id])

  if (id === null) return <Picker />
  if (loaded === null) return <Panel title="Анализ">Загружаю…</Panel>
  if (loaded === 'missing') {
    return (
      <Panel title="Анализ">
        <p className="text-sm">
          Прошивка не найдена — возможно, её удалили.{' '}
          <a href="#/library" className="underline">Открыть Библиотеку</a>
        </p>
      </Panel>
    )
  }
  return <AnalysisView record={loaded.record} data={loaded.data} />
}
```

- [ ] **Step 5: Сборка**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: экран «Анализ» — сводка, разделы, строки, HEX"
```

---

### Task 15: Экран «Заливка»

**Files:**
- Modify: `firmware-site/src/ui/pages/FlashPage.tsx` (полностью заменить заглушку)

**Interfaces:**
- Consumes: `useConnection` (Task 10); `checkCompatibility` (Task 9); `listFirmware`, `getFirmwareData`, `kindLabel`, `FirmwareRecord` (Task 8); `Partition` (Task 3); `BoardDriver` (Task 4); `ExplainedError` (Task 7); `ImportButton`, `formatDate` (Task 13); `Panel`, `StatusDot`, `ErrorCallout`, `OperationProgress` (Task 11); `formatSize`, `hexAddr` (Task 1).
- Produces: `FlashPage({ id })`.

- [ ] **Step 1: Реализовать экран**

`firmware-site/src/ui/pages/FlashPage.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Info, RefreshCw, Upload } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatSize, hexAddr } from '@/analysis/bytes'
import type { Partition } from '@/analysis/partitions'
import type { ExplainedError } from '@/drivers/explainError'
import type { BoardDriver } from '@/drivers/types'
import { checkCompatibility } from '@/flash/compat'
import { type FirmwareRecord, getFirmwareData, kindLabel, listFirmware } from '@/library/library'
import { useConnection } from '@/state/ConnectionContext'
import { ErrorCallout } from '../components/ErrorCallout'
import { OperationProgress } from '../components/OperationProgress'
import { Panel } from '../components/Panel'
import { StatusDot } from '../components/StatusDot'
import { formatDate } from '../library/downloadRecord'
import { ImportButton } from '../library/ImportButton'

interface BoardLayout {
  partitions: Partition[]
  activeApp: Partition | null
}

export function FlashPage({ id }: { id: number | null }) {
  const { status, op, run, disconnect } = useConnection()
  const driver = status.kind === 'connected' ? status.driver : null
  const portLabel = status.kind === 'connected' ? status.portLabel : ''
  const currentDriver = useRef<BoardDriver | null>(null)
  currentDriver.current = driver
  const records = useLiveQuery(listFirmware, [], [] as FirmwareRecord[])
  const [selectedId, setSelectedId] = useState<number | null>(id)
  const record = records.find((r) => r.id === selectedId) ?? null
  const [layout, setLayout] = useState<BoardLayout | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<ExplainedError | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // У ESP32 адрес записи приложения и раздела берётся из таблицы разделов платы-получателя.
  const loadLayout = useCallback(() => {
    setLayout(null)
    if (!driver || driver.info.family !== 'esp32') return
    void run(
      'Читаю разделы платы',
      async (d) => ({
        partitions: await (d.readPartitionTable?.() ?? Promise.resolve([] as Partition[])).catch(() => [] as Partition[]),
        activeApp: await (d.activeAppPartition?.() ?? Promise.resolve(null)).catch(() => null),
      }),
      { cancellable: false },
    ).then((r) => {
      if (currentDriver.current === driver && r.ok) setLayout(r.value)
    })
  }, [driver, run])

  useEffect(loadLayout, [loadLayout])

  const compat =
    record && driver
      ? checkCompatibility({ firmware: record, board: driver.info, partitions: layout?.partitions, activeApp: layout?.activeApp })
      : null

  function select(value: string) {
    setSelectedId(Number(value))
    setDone(null)
    setError(null)
  }

  async function onFlash() {
    setConfirmOpen(false)
    setError(null)
    setDone(null)
    if (!record || !compat?.ok) return
    const blob = await getFirmwareData(record.id)
    if (!blob) {
      setError({ title: 'Прошивка не найдена в Библиотеке', raw: '' })
      return
    }
    const r = await run('Заливка прошивки', (d, p, s) => d.write(blob.data, compat.address, p, s))
    if (!r.ok) {
      if (!r.error.silent) setError(r.error)
      return
    }
    setDone(`Прошивка «${record.name}» записана и проверена. Плата перезагружена и работает с новой прошивкой.`)
    await disconnect() // ESP32 выходит из загрузчика только по сбросу; Arduino — отпускаем порт
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-medium">Заливка</h1>

      <Panel title="Что заливаем">
        <div className="flex flex-wrap items-start gap-3">
          <Select value={selectedId === null ? '' : String(selectedId)} onValueChange={select}>
            <SelectTrigger className="w-full sm:w-[28rem]">
              <SelectValue placeholder="Выберите прошивку из Библиотеки" />
            </SelectTrigger>
            <SelectContent>
              {records.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.name} · {r.chip} · {kindLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ImportButton onImported={(rec) => select(String(rec.id))} />
        </div>
        {record && (
          <div className="mt-3 text-sm text-muted-foreground">
            {record.chip} · {kindLabel(record)} · {formatSize(record.size)} · {formatDate(record.createdAt)}
            <div className="break-all">SHA-256: {record.sha256}</div>
          </div>
        )}
      </Panel>

      <Panel title="Куда">
        {driver ? (
          <div className="flex items-start gap-3">
            <StatusDot tone="ok" className="mt-1.5" />
            <div>
              <div className="font-medium">
                {driver.info.chip} · {formatSize(driver.info.flashSize)} flash
              </div>
              <div className="text-sm text-muted-foreground">{portLabel}</div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <StatusDot tone="idle" />
            <span className="text-sm">Плата не подключена.</span>
            <Button variant="outline" asChild>
              <a href="#/device">Подключить на экране «Устройство»</a>
            </Button>
          </div>
        )}
      </Panel>

      {record && driver && compat && (
        <Panel title="Проверка">
          {compat.ok ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <StatusDot tone="ok" /> Совместимо: запись с адреса {hexAddr(compat.address)}
              </div>
              {compat.warnings.map((w) => (
                <div key={w} className="flex gap-2 text-sm text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  {w}
                </div>
              ))}
            </div>
          ) : (
            <ErrorCallout error={{ title: 'Залить нельзя', hint: compat.reason }} />
          )}
          {driver.info.family === 'esp32' && layout === null && op === null && record.kind !== 'full' && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={loadLayout}>
              <RefreshCw className="size-4" /> Перечитать разделы платы
            </Button>
          )}
          <div className="mt-4">
            <Button onClick={() => setConfirmOpen(true)} disabled={!compat.ok || op !== null}>
              <Upload className="size-4" /> Залить
            </Button>
          </div>
          <OperationProgress className="mt-4" />
          {error && <ErrorCallout error={error} className="mt-4" />}
        </Panel>
      )}

      {done && (
        <Panel title="Готово">
          <div className="flex items-start gap-3">
            <StatusDot tone="ok" className="mt-1.5" />
            <div className="text-sm">{done}</div>
          </div>
        </Panel>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Данные на плате будут перезаписаны</AlertDialogTitle>
            <AlertDialogDescription>
              {record && driver && compat?.ok
                ? `Запишу «${record.name}» (${formatSize(record.size)}) с адреса ${hexAddr(compat.address)} на ${driver.info.chip}. Если запись прервётся, плата может не запуститься — тогда просто залейте прошивку ещё раз.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onFlash()}>Залить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

- [ ] **Step 2: Сборка**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 3: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add firmware-site
git commit -m "feat: экран «Заливка» с проверкой совместимости"
```

---

### Task 16: Проверка целиком, запуск на ПК, README

**Files:**
- Create: `.claude/launch.json`
- Create: `firmware-site/README.md`
- Modify: `docs/superpowers/specs/2026-09-30-firmware-reader-design.md` (статус)

**Interfaces:**
- Consumes: всё приложение.
- Produces: работающий сайт на `http://localhost:5173`, README с чек-листом для проверки на железе.

- [ ] **Step 1: Все автоматические проверки**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику/firmware-site"
npm test
npm run lint
npm run build
```

Expected: все тесты PASS; ESLint без ошибок (предупреждения `react-refresh/only-export-components` в `src/components/ui/*` от shadcn допустимы); `✓ built`. Любую ошибку — исправить в коде, не отключая правило.

- [ ] **Step 2: Конфигурация предпросмотра**

`.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "firmware-site",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["--prefix", "firmware-site", "run", "dev"],
      "port": 5173
    }
  ]
}
```

- [ ] **Step 3: Ручная проверка во встроенном браузере**

Запустить предпросмотр `firmware-site` (`preview_start` с `name: "firmware-site"`). Если встроенный браузер показывает экран «Этот браузер не умеет работать с COM-портами» — нажать «Открыть Библиотеку и Анализ без платы» (это тоже проверка экрана).

Засеять библиотеку фикстурами через консоль страницы (`javascript_tool`):

```js
const lib = await import('/src/library/library.ts')
const idf = await import('/src/library/identify.ts')
const load = async (name) => new Uint8Array(await (await fetch(`/tests/fixtures/${name}`)).arrayBuffer())
const app = idf.identifyFile('esp32-app.bin', await load('esp32-app.bin'))
const hex = idf.identifyFile('avr-blink.hex', await load('avr-blink.hex'))
const a = await lib.saveFirmware({ ...app, source: 'file' })
const b = await lib.saveFirmware({ ...hex, source: 'file' })
;[a.id, b.id]
```

Проверить и отметить:
- «Устройство»: серая точка «Порт не выбран», кнопка «Выбрать COM-порт».
- «Библиотека»: две записи, у AVR есть «HEX», «Удалить» спрашивает подтверждение.
- «Анализ» ESP32-записи: паспорт `pauluk_fixture 1.2.3`, вкладка «Строки» находит `Privet ot Paulukevichusa`, клик по адресу открывает HEX с подсветкой.
- «Анализ» AVR-записи: вкладки «Разделы» нет, строка найдена.
- «Заливка» без платы: «Плата не подключена» и ссылка на «Устройство».
- Тема: открыть «Тема», выбрать Dracula — фон страницы `#21222C`; «Как в системе» — возврат; после перезагрузки выбор сохраняется.
- Узкое окно: `resize_window` preset `mobile` — меню только иконками, нет горизонтальной прокрутки страницы; вернуть `desktop`.

- [ ] **Step 4: README с чек-листом для железа**

`firmware-site/README.md`:

````markdown
# Прошивки Паулюкевичуса

Сайт для чтения, скачивания и заливки прошивок Arduino (Uno / Nano / Pro Mini, ATmega328P)
и ESP32 / ESP32-S2 / ESP32-S3 / ESP32-C3 прямо из браузера. Сервера нет: плата подключается
к компьютеру того, кто открыл сайт, прошивки хранятся только в его браузере.

## Запуск на своём ПК

Двойной щелчок по `start.bat` — при первом запуске установятся зависимости, затем откроется
http://localhost:5173. Нужен Chrome, Edge или Яндекс Браузер на компьютере (Web Serial).

## Публикация в интернете

```bash
npm run build
```

Папку `dist/` можно выложить на любой статический хостинг с HTTPS (GitHub Pages, Netlify,
Cloudflare Pages). Без HTTPS браузер не даст доступ к COM-порту.

## Проверка на железе

1. Arduino Nano/Uno: «Выбрать COM-порт» → зелёная точка «ATmega328P» → «Считать» → «Скачать .hex».
2. Экран «Заливка»: залить эту прошивку на вторую такую же плату → «Готово» → плата работает так же.
3. Считать вторую плату и сравнить SHA-256 с первой (совпадёт, если загрузчики одинаковые).
4. ESP32: «Вся flash» (4 МБ — 1–5 минут) → залить на вторую плату → работает, настройки Wi-Fi сохранились.
5. ESP32: «Только приложение» → залить на плату с той же таблицей разделов.
6. Выдернуть кабель во время чтения → «Кабель отключён», страница не зависла.
7. Открыть монитор порта в Arduino IDE и нажать «Выбрать COM-порт» → «Порт занят другой программой».

## Разработка

```bash
npm test        # юнит-тесты (эмулятор загрузчика Arduino, поддельный esptool, фикстуры ESP-IDF)
npm run build   # сборка
```

Эталонные прошивки для тестов собираются PlatformIO из `tools/fixtures/` (см. план реализации).
````

- [ ] **Step 5: Отметить спецификацию реализованной**

В `docs/superpowers/specs/2026-09-30-firmware-reader-design.md` заменить `Статус: на согласовании` на `Статус: утверждена, реализована`.

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/mpavl/OneDrive/Рабочий стол/W/Узнай прошику"
git add .claude/launch.json firmware-site/README.md docs
git commit -m "docs: README с чек-листом проверки на железе, запуск предпросмотра"
```

