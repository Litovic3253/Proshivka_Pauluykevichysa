import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from './dataDir.mjs'
import { createLibraryStore } from './libraryStore.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
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
  ipcMain.handle('library:list', () => store.list())
  ipcMain.handle('library:save', (_e, meta, data, eeprom) => store.save(meta, data, eeprom))
  ipcMain.handle('library:read', (_e, id) => store.read(Number(id)))
  ipcMain.handle('library:update', (_e, id, patch) => store.update(Number(id), patch ?? {}))
  ipcMain.handle('library:remove', (_e, id) => store.remove(Number(id)))
  ipcMain.handle('library:folder', () => store.folderInfo())
  ipcMain.handle('library:openFolder', async () => {
    await store.list()
    await shell.openPath(store.dir)
  })
  ipcMain.handle('library:showInFolder', async (_e, id) => {
    const p = await store.filePath(Number(id))
    if (p) shell.showItemInFolder(p)
    else await shell.openPath(store.dir)
  })
  ipcMain.handle('files:saveAs', async (_e, defaultName, data) => {
    const name = String(defaultName)
    const isHex = /\.hex$/i.test(name)
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
  const send = () => getMain()?.webContents.send('ports:request', ports.map(toChoice))

  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'serial' || permission === 'clipboard-sanitized-write')
  session.defaultSession.setDevicePermissionHandler((details) => details.deviceType === 'serial')
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
  main.loadFile(path.join(root, 'dist', 'index.html'))
  main.once('ready-to-show', () => step(60, 'Загружаю интерфейс'))

  let resolveShown
  const shown = new Promise((r) => {
    resolveShown = r
  })
  let finished = false
  const finish = async () => {
    if (finished) return
    finished = true
    if (!splash.isDestroyed()) await splash.webContents.executeJavaScript('window.finish()').catch(() => {})
    if (!splash.isDestroyed()) splash.destroy()
    main.show()
    resolveShown()
  }
  ipcMain.once('app:ready', () => void finish())
  setTimeout(() => void finish(), SPLASH_TIMEOUT)

  app.on('second-instance', () => {
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
  })
  app.on('window-all-closed', () => app.quit())
  return { main, shown }
}
