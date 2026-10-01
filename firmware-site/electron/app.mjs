import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from './dataDir.mjs'
import { allowPermission, isOwnPage } from './guards.mjs'
import { createLibraryStore, safeFileName } from './libraryStore.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const indexFile = path.join(root, 'dist', 'index.html')
const SPLASH_TIMEOUT = 15_000

function createSplash() {
  const win = new BrowserWindow({
    width: 360, height: 360, frame: false, transparent: true, resizable: false, alwaysOnTop: true,
    skipTaskbar: true, show: false, center: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.loadFile(path.join(here, 'splash.html'))
  win.once('ready-to-show', () => win.show())
  return win
}

function createMain() {
  return new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 520, show: false,
    title: 'Прошивки Паулюкевичуса',
    icon: path.join(root, 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0A0A0B' : '#FAFAFA',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
}

function registerLibrary(getMain) {
  const dir = path.join(dataDir({ env: process.env, isPackaged: app.isPackaged, execPath: process.execPath, devRoot: root }), 'Прошивки')
  const store = createLibraryStore(dir, { trash: (p) => shell.trashItem(p), log: (m) => console.warn(m) })
  /** Команды принимаются только от главного окна программы. */
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== getMain()?.webContents) throw new Error('Команда отклонена: не из окна программы')
      return fn(...args)
    })
  handle('library:list', () => store.list())
  handle('library:save', (meta, data, eeprom) => store.save(meta, data, eeprom))
  handle('library:read', (id) => store.read(Number(id)))
  handle('library:update', (id, patch) => store.update(Number(id), patch ?? {}))
  handle('library:remove', (id, permanent) => store.remove(Number(id), permanent === true))
  handle('library:folder', () => store.folderInfo())
  handle('library:openFolder', async () => {
    await store.list()
    await shell.openPath(store.dir)
  })
  handle('library:showInFolder', async (id) => {
    const p = await store.filePath(Number(id))
    if (p) shell.showItemInFolder(p)
    else await shell.openPath(store.dir)
  })
  handle('files:saveAs', async (defaultName, data) => {
    if (typeof data !== 'string' && !(data instanceof Uint8Array)) throw new Error('Неверные данные для сохранения')
    const ext = path.extname(String(defaultName)).toLowerCase() === '.hex' ? '.hex' : '.bin'
    // В названии могут быть / \ : * ? — окно «Сохранить как…» такое имя не примет.
    const name = safeFileName(path.basename(String(defaultName), path.extname(String(defaultName)))) + ext
    const isHex = ext === '.hex'
    const result = await dialog.showSaveDialog(getMain(), {
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: [isHex ? { name: 'Intel HEX', extensions: ['hex'] } : { name: 'Прошивка', extensions: ['bin'] }],
    })
    if (result.canceled || !result.filePath) return 'cancelled'
    await writeFile(result.filePath, typeof data === 'string' ? data : Buffer.from(data))
    return 'saved'
  })
}

/** Web Serial в Electron: вместо системного окна Chrome — наше окно со списком «COM5 · …». */
function registerSerial(getMain) {
  let pending = null
  let ports = []
  const toChoice = (p) => ({ portId: p.portId, portName: p.portName, displayName: p.displayName, vendorId: p.vendorId, productId: p.productId })
  const send = () => {
    const main = getMain()
    if (main && !main.isDestroyed()) main.webContents.send('ports:request', ports.map(toChoice))
  }

  const isMain = (wc) => wc !== null && wc === getMain()?.webContents
  session.defaultSession.setPermissionCheckHandler((wc, permission) => isMain(wc) && allowPermission(permission))
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(isMain(wc) && allowPermission(permission)))
  session.defaultSession.setDevicePermissionHandler((details) => details.deviceType === 'serial' && details.origin.startsWith('file://'))
  session.defaultSession.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault()
    pending?.('') // предыдущий запрос, если был, отменяем
    pending = callback
    ports = portList
    send()
  })
  session.defaultSession.on('serial-port-added', (_e, port) => {
    if (!pending) return
    ports = [...ports.filter((p) => p.portId !== port.portId), port]
    send()
  })
  session.defaultSession.on('serial-port-removed', (_e, port) => {
    if (!pending) return
    ports = ports.filter((p) => p.portId !== port.portId)
    send()
  })
  ipcMain.on('ports:choose', (_e, portId) => {
    const cb = pending
    pending = null
    ports = []
    cb?.(typeof portId === 'string' ? portId : '')
  })
}

export async function startApp() {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return null
  }
  await app.whenReady()
  let main = null
  const getMain = () => main
  registerLibrary(getMain)
  registerSerial(getMain)

  const splash = createSplash()
  const step = (pct, text) =>
    splash.isDestroyed()
      ? Promise.resolve()
      : splash.webContents.executeJavaScript(`window.setStep(${pct}, ${JSON.stringify(text)})`).catch(() => {})
  splash.webContents.once('did-finish-load', () => step(25, 'Открываю окно'))

  main = createMain()
  main.removeMenu()
  // Окно показывает только свою страницу: ни новых окон, ни перехода по перетащенному файлу или ссылке.
  main.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  main.webContents.on('will-navigate', (event, url) => {
    if (!isOwnPage(url, indexFile)) event.preventDefault()
  })
  // Интерфейс просит не закрывать окно во время чтения или заливки — Electron сам вопроса не задаёт.
  main.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(main, {
      type: 'question',
      buttons: ['Остаться', 'Закрыть'],
      defaultId: 0,
      cancelId: 0,
      title: 'Прошивки Паулюкевичуса',
      message: 'Идёт работа с платой',
      detail: 'Если закрыть программу сейчас, чтение или заливка прервутся. Прерванную заливку нужно будет повторить.',
    })
    if (choice === 1) event.preventDefault() // разрешить закрытие
  })
  main.loadFile(indexFile)
  main.once('ready-to-show', () => step(60, 'Загружаю интерфейс'))

  let resolveShown
  const shown = new Promise((r) => {
    resolveShown = r
  })
  let revealed = false
  const reveal = () => {
    if (revealed) return
    revealed = true
    if (!splash.isDestroyed()) splash.destroy()
    if (!main.isDestroyed()) main.show()
    resolveShown()
  }
  let finishing = false
  const finish = async () => {
    if (finishing) return
    finishing = true
    if (!splash.isDestroyed()) await splash.webContents.executeJavaScript('window.finish()').catch(() => {})
    reveal()
  }
  ipcMain.once('app:ready', () => void finish())
  // Запасной путь: окно покажется, даже если интерфейс не ответил или заставка зависла.
  setTimeout(reveal, SPLASH_TIMEOUT)

  app.on('second-instance', () => {
    if (main.isDestroyed()) return
    if (!revealed) return // ещё идёт заставка — окно покажется само
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
  })
  app.on('window-all-closed', () => app.quit())
  return { main, shown }
}
