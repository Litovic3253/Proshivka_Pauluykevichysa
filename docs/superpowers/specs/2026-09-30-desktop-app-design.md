# Прошивки Паулюкевичуса — программа для Windows (дополнение к спецификации)

Дата: 2026-09-30
Статус: на согласовании
Основа: `2026-09-30-firmware-reader-design.md` (дальше — «базовая спецификация»). Всё, что
там не изменено этим документом, действует как есть: драйверы, анализ, совместимость, экраны,
темы, ошибки.

## 1. Цель

Вместо сайта — программа для Windows «как Студия Паулюкевичуса», только для одного
пользователя на его ПК: один переносной `.exe`, данные рядом с ним, интернет не нужен.

## 2. Что меняется по сравнению с базовой спецификацией

| Было (сайт) | Стало (программа) |
|---|---|
| Статический сайт, Chrome/Edge/Яндекс | Electron, собственное окно |
| Системное окно выбора порта Chrome, номер COM не виден | Своё окно выбора порта с именами «COM5 · USB-SERIAL CH340» |
| Порт подписан по USB VID:PID | Порт подписан «COM5 · CH340 · USB 1A86:7523» |
| Библиотека в IndexedDB браузера | Папка «Прошивки» рядом с `.exe`: `library.json` + файлы прошивок |
| «Скачать .bin/.hex» | «Сохранить как…» (окно Windows) и «Показать в папке» |
| Экран «браузер не поддерживается», режим без платы | Убраны |
| `start.bat`, публикация на хостинг | Убраны; `build_exe.bat` собирает `.exe`, `npm run app` — запуск при разработке |
| Иконка Студии | Своя иконка в стиле Студии |
| — | Заставка при запуске, как в Студии |

Остаются без изменений: `src/analysis`, `src/drivers`, `src/serial`, `src/flash`,
`src/state/operationRunner.ts`, экраны и их логика, темы.

## 3. Архитектура

```
firmware-site/
  electron/
    main.cjs          окна (заставка → главное), обработчики Web Serial, IPC
    preload.cjs       мост contextBridge → window.pauluk
    libraryStore.cjs  хранилище «Прошивки» (чистый Node, без Electron)
    ports.cjs         подписи портов из списка Electron (чистая функция)
    splash.html       заставка
    dataDir.cjs       где лежит папка «Прошивки»
  src/...             интерфейс (React), как раньше
  build/icon.ico, build/icon.png, public/icon.png   иконка
  build_exe.bat
```

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` для главного окна.
  Интерфейс видит только `window.pauluk` (см. §4).
- Интерфейс загружается из собранного `dist/index.html` (`loadFile`, Vite `base: './'`).
  `file://` — безопасный контекст, Web Serial работает.
- Electron: актуальная стабильная версия; electron-builder, цель `portable` (один `.exe`).

### 3.1 Папка данных

`dataDir()`:
1. собранный `.exe`: `process.env.PORTABLE_EXECUTABLE_DIR` (папка, где лежит `.exe`;
   сам `.exe` распаковывается во временную папку, как у Студии);
2. при разработке: `firmware-site/`.

Папка «Прошивки» = `dataDir()/Прошивки`, создаётся при первом запуске. Тема и размер окна —
в стандартном профиле Electron (`%APPDATA%`), это не данные пользователя.

## 4. Мост `window.pauluk`

```ts
interface PaulukBridge {
  library: {
    list(): Promise<FirmwareRecord[]>                                  // новые сверху
    save(meta: NewFirmwareMeta, data: Uint8Array, eeprom?: Uint8Array): Promise<FirmwareRecord>
    read(id: number): Promise<{ data: Uint8Array; eeprom?: Uint8Array } | null>
    update(id: number, patch: { name?: string; note?: string }): Promise<FirmwareRecord>
    remove(id: number): Promise<void>                                  // файлы — в Корзину
    folder(): Promise<{ path: string; bytes: number; count: number }>
    openFolder(): Promise<void>
    showInFolder(id: number): Promise<void>
  }
  files: {
    saveAs(defaultName: string, data: Uint8Array | string): Promise<'saved' | 'cancelled'>
  }
  ports: {
    /** Интерфейс получает список, когда вызван navigator.serial.requestPort(), и при изменениях. */
    onRequest(cb: (ports: PortChoice[]) => void): () => void
    choose(portId: string | null): void                               // null — отмена
  }
}
interface PortChoice { portId: string; portName: string; label: string }  // label: «COM5 · CH340 · USB 1A86:7523»
```

`FirmwareRecord` — как в базовой спецификации §5.2 / коде `src/library/db.ts`, плюс
`file: string` (имя файла прошивки в папке) и `eepromFile?: string`. `sha256` считает
интерфейс (Web Crypto), `libraryStore` его только хранит.

## 5. Хранилище «Прошивки» (`libraryStore.cjs`)

- `library.json`: `{ version: 1, nextId: number, records: FirmwareRecord[] }`.
- Имя файла: `<name>.bin` (для AVR тоже `.bin`; `.hex` делается при «Сохранить как…»),
  EEPROM — `<name>_eeprom.bin`. Символы, запрещённые в Windows, заменяются `_`. Если файл
  с таким именем уже есть — добавляется ` (2)`, ` (3)` и т. д.
- Запись атомарная: сначала `*.tmp`, затем `rename`. Сначала пишутся файлы прошивки, потом
  `library.json`.
- Переименование в программе переименовывает и файлы (с тем же правилом уникальности).
- Удаление: файлы — в Корзину (`shell.trashItem`, внедряется в store как зависимость),
  запись — из `library.json`.
- `library.json` нет — пустая библиотека. `library.json` битый — он переименовывается в
  `library.broken-<дата>.json`, библиотека начинается пустой, в журнал пишется предупреждение;
  файлы прошивок не трогаются.
- Запись, у которой файл пропал с диска: в списке остаётся, `read` возвращает `null`,
  интерфейс пишет «Файл прошивки не найден в папке — его удалили или переименовали вручную».

## 6. Выбор порта

- `main.cjs` подписывается на `session.on('select-serial-port')`, делает
  `event.preventDefault()`, отправляет список в окно (`ports:request`) и хранит `callback`.
  `serial-port-added` / `serial-port-removed` пересылают обновлённый список.
  Выбор `choose(portId)` вызывает `callback(portId)`; отмена — `callback('')` (интерфейс
  получает `NotFoundError`, как сейчас — молча).
- Разрешения: `setPermissionCheckHandler` и `setDevicePermissionHandler` разрешают только
  `serial` и только для своего окна.
- `ports.cjs` → `describeElectronPort(p)`: `«<portName> · <адаптер> · USB <VID>:<PID>»`,
  адаптер — по таблице базовой спецификации (`src/serial/portName.ts`), иначе `displayName`
  от Windows, иначе «USB-адаптер»; порт без USB — `«<portName> · <displayName>»`.
- Окно выбора — диалог в стиле Студии (`src/ui/layout/PortPickerDialog.tsx`): список портов
  с точкой, «Отмена» / «Выбрать», пустое состояние «Подключите плату по USB — список
  обновится сам». Выбранное имя (`COM5`) сохраняется в контексте подключения и
  показывается в статусе «Подключено · COM5 · CH340 · 921600 бод».

## 7. Интерфейс: что меняется

- `src/library/library.ts` — те же функции (`saveFirmware`, `listFirmware`, `getFirmware`,
  `getFirmwareData`, `updateFirmware`, `deleteFirmware`), но через `window.pauluk.library`;
  `storageEstimate` заменяется `libraryFolder()`. Dexie и `dexie-react-hooks` удаляются;
  вместо `useLiveQuery` — свой хук `useLibrary()` (подписка на изменения из этого же модуля).
- «Скачать .bin / .hex / EEPROM» → «Сохранить .bin / .hex / EEPROM» (окно «Сохранить как…»);
  в Библиотеке и Анализе — «Показать в папке»; в Библиотеке — «Открыть папку» и строка
  «Папка: <путь> · N прошивок · X МБ».
- Удаляются: `UnsupportedBrowser`, проверка `navigator.serial` в `App.tsx`, `start.bat`,
  `src/lib/download.ts`.
- Логотип в меню и на заставке — новая иконка.

## 8. Заставка

- `splash.html` в отдельном окне 360×360 без рамки, прозрачный фон, по центру экрана, поверх.
- Логотип (новая иконка) переворачивается по оси Y каждые 0,75 с, за ним пульсирует ореол
  цвета акцента; внизу полоска 4 px и крупные проценты (JetBrains Mono), подпись шага.
- Проценты догоняют цель по 1 % за 18 мс (не быстрее ~1,8 с на 0→100 %). Цели:
  25 % — «Открываю окно», 60 % — «Загружаю интерфейс» (главное окно `ready-to-show`),
  100 % — «Готово» (интерфейс прочитал библиотеку и сообщил `app:ready`).
- На 100 %: заставка закрывается, главное окно показывается (`show: false` до этого).
  Если интерфейс не ответил за 15 с — главное окно показывается всё равно.
- Цвета заставки — светлая/тёмная по системе (тема из профиля интерфейсу ещё недоступна).

## 9. Иконка

SVG 256×256: жёлтый скруглённый квадрат (цвет и радиус — как у иконки Студии), в центре —
микросхема (квадрат с ножками по четырём сторонам) тёмным цветом. Генерируется скриптом
`tools/make-icon.mjs` в `build/icon.png` (256), `build/icon.ico` (16–256), `public/icon.png`.

## 10. Сборка и запуск

- `npm run app` — `vite build` и `electron .` (разработка).
- `build_exe.bat` (как у Студии): `npm install` при необходимости, `vite build`,
  `electron-builder --win portable` → `dist-app\Прошивки Паулюкевичуса.exe`.
  `productName`, `appId: ru.pauluk.firmware`, иконка `build/icon.ico`.
- `Как установить.txt` рядом с `.exe`: куда положить, SmartScreen «Подробнее → Выполнить в
  любом случае», где хранятся данные.

## 11. Тестирование

- Существующие 117 тестов остаются; тесты библиотеки на `fake-indexeddb` заменяются тестами
  `libraryStore` на реальной временной папке: сохранение, список, уникальные имена,
  переименование вместе с файлами, удаление через внедрённый `trash`, битый `library.json`,
  пропавший файл, атомарность (нет `*.tmp` после записи).
- `ports.cjs`: подписи для CH340, CP2102, неизвестного адаптера, порта без USB.
- Ручная проверка: собранный `.exe` запускается, заставка доходит до 100 %, все экраны,
  «Сохранить как…», «Показать в папке», окно выбора порта со списком (без платы — пустое
  состояние). Выбор порта с платой — пользователь.
