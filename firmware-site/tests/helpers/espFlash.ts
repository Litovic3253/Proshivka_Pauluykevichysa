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
