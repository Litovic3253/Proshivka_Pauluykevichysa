import { formatIntelHex } from '@/analysis/intelHex'
import { saveFile } from '@/lib/saveFile'
import { type FirmwareRecord, getFirmwareData, MISSING_FILE } from '@/library/library'

export async function saveRecordAs(rec: FirmwareRecord, format: 'bin' | 'hex' | 'eeprom'): Promise<void> {
  const blob = await getFirmwareData(rec.id)
  if (!blob) throw new Error(MISSING_FILE)
  if (format === 'hex') await saveFile(`${rec.name}.hex`, formatIntelHex(blob.data, rec.baseAddress))
  else if (format === 'eeprom') {
    if (blob.eeprom) await saveFile(`${rec.name}_eeprom.bin`, blob.eeprom)
  } else await saveFile(`${rec.name}.bin`, blob.data)
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}
