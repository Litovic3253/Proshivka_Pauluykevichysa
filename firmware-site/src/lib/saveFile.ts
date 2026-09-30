import { bridge } from '@/bridge'

/** Окно Windows «Сохранить как…». */
export async function saveFile(defaultName: string, data: Uint8Array | string): Promise<void> {
  await bridge().files.saveAs(defaultName, data)
}
