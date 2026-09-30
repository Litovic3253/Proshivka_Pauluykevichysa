import { formatSize, hexAddr } from '@/analysis/bytes'
import type { Partition } from '@/analysis/partitions'
import { appAreaEnd } from '@/drivers/avr/avrDriver'
import type { BoardInfo, Family } from '@/drivers/types'
import type { DumpKind } from '@/library/types'

export interface CompatInput {
  firmware: { family: Family; chip: string; kind: DumpKind; size: number; baseAddress: number; partitionLabel?: string }
  board: BoardInfo
  partitions?: Partition[]
  activeApp?: Partition | null
}

export type CompatResult = { ok: true; address: number; warnings: string[] } | { ok: false; reason: string }

const fail = (reason: string): CompatResult => ({ ok: false, reason })

/** Решает, можно ли залить прошивку на подключённую плату и по какому адресу. */
export function checkCompatibility({ firmware, board, partitions = [], activeApp = null }: CompatInput): CompatResult {
  if (firmware.family !== board.family || firmware.chip !== board.chip) {
    return fail(`Прошивка для ${firmware.chip}, а подключена ${board.chip}`)
  }
  if (firmware.size > board.flashSize) {
    return fail(`Прошивка (${formatSize(firmware.size)}) не помещается во flash платы (${formatSize(board.flashSize)})`)
  }
  if (board.family === 'avr') {
    if (firmware.baseAddress !== 0) {
      return fail(`Файл начинается с адреса ${hexAddr(firmware.baseAddress)}, а скетч Arduino начинается с 0 — похоже, это загрузчик, а не прошивка`)
    }
    const end = appAreaEnd(board.bootloader ?? 'unknown')
    const warnings =
      firmware.size > end
        ? [`Всё, что в файле дальше ${hexAddr(end)} (область загрузчика), будет пропущено — на плате останется её собственный загрузчик. Если там код скетча, заливка остановится до записи`]
        : []
    return { ok: true, address: 0, warnings }
  }
  if (firmware.kind === 'full') {
    const warnings =
      firmware.size < board.flashSize
        ? [`Прошивка меньше flash платы: будут перезаписаны первые ${formatSize(firmware.size)}, остальное останется как есть`]
        : []
    return { ok: true, address: 0, warnings }
  }
  if (firmware.kind === 'app') {
    if (!activeApp) return fail('На плате нет раздела для приложения — сначала залейте полный дамп')
    if (firmware.size > activeApp.size) {
      return fail(`Приложение (${formatSize(firmware.size)}) больше раздела ${activeApp.label} (${formatSize(activeApp.size)})`)
    }
    return { ok: true, address: activeApp.offset, warnings: [`Запись в активный раздел ${activeApp.label} (${hexAddr(activeApp.offset)})`] }
  }
  const p = partitions.find((x) => x.label === firmware.partitionLabel)
  if (!p) return fail(`На плате нет раздела «${firmware.partitionLabel ?? '?'}»`)
  if (firmware.size > p.size) return fail(`Дамп (${formatSize(firmware.size)}) больше раздела ${p.label} (${formatSize(p.size)})`)
  return { ok: true, address: p.offset, warnings: [] }
}
