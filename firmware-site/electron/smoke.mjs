/** Дымовой прогон: запускает программу, снимает заставку и все экраны в PNG, пишет текст экранов. Не входит в exe. */
import { app, BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startApp } from './app.mjs'

const out = path.join(process.env.TEMP ?? '.', 'pauluk-smoke')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Без await на верхнем уровне: в ESM-точке входа Electron не наступит ready, пока модуль не выполнится.
async function run() {
  const started = await startApp()
  await mkdir(out, { recursive: true })
  await sleep(600)
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== started.main && win.isVisible()) await writeFile(path.join(out, 'splash.png'), (await win.capturePage()).toPNG())
  }
  await started.shown
  const report = []
  for (const route of ['device', 'library', 'analysis', 'flash']) {
    await started.main.webContents.executeJavaScript(`location.hash = '#/${route}'`)
    await sleep(700)
    await writeFile(path.join(out, `${route}.png`), (await started.main.webContents.capturePage()).toPNG())
    report.push(`--- ${route}\n` + (await started.main.webContents.executeJavaScript('document.querySelector("main")?.innerText ?? ""')))
  }
  report.push('--- bridge\n' + (await started.main.webContents.executeJavaScript('typeof window.pauluk + " " + typeof navigator.serial')))
  await writeFile(path.join(out, 'report.txt'), report.join('\n'))
  console.log('SMOKE OK', out)
  app.quit()
}

run().catch((e) => {
  console.error('SMOKE FAILED', e)
  app.exit(1)
})
