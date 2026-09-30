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
