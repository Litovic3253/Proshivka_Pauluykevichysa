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
