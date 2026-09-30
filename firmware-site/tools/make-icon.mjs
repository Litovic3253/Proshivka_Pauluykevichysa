/** Иконка «Прошивок Паулюкевичуса»: жёлтый квадрат Студии, вместо кубика — микросхема. */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const BG = '#FABD2F'
const FG = '#1D2021'

export function iconSvg() {
  const pins = [103, 128, 153]
  const lines = pins
    .flatMap((p) => [
      `M${p} 52V78`, `M${p} 178V204`, // сверху и снизу
      `M52 ${p}H78`, `M178 ${p}H204`, // слева и справа
    ])
    .join(' ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect x="7" y="7" width="242" height="242" rx="56" fill="${BG}"/>
  <path d="${lines}" stroke="${FG}" stroke-width="12" stroke-linecap="round"/>
  <rect x="78" y="78" width="100" height="100" rx="16" fill="none" stroke="${FG}" stroke-width="12"/>
  <rect x="104" y="104" width="48" height="48" rx="8" fill="${FG}"/>
</svg>`
}

export function renderPng(size) {
  return new Resvg(iconSvg(), { fitTo: { mode: 'width', value: size } }).render().asPng()
}

async function main() {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  await mkdir(path.join(root, 'build'), { recursive: true })
  const png256 = renderPng(256)
  await writeFile(path.join(root, 'build', 'icon.png'), png256)
  await writeFile(path.join(root, 'public', 'icon.png'), png256)
  const ico = await pngToIco([16, 24, 32, 48, 64, 128, 256].map(renderPng))
  await writeFile(path.join(root, 'build', 'icon.ico'), ico)
  console.log('Иконка готова: build/icon.ico, build/icon.png, public/icon.png')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
