import { u32le } from './bytes'
import type { Partition } from './partitions'

/** CRC-32 (zlib). prev — предыдущее значение, как в binascii.crc32(data, prev) и esp_rom_crc32_le. */
export function crc32(data: Uint8Array, prev = 0): number {
  let crc = ~prev >>> 0
  for (const byte of data) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return ~crc >>> 0
}

const OTA_IMG_INVALID = 3
const OTA_IMG_ABORTED = 4

/** Две копии esp_ota_select_entry_t (по сектору): seq, label[20], state, crc. Побеждает больший seq. */
export function activeOtaSeq(otadata: Uint8Array): number | null {
  let best: number | null = null
  for (const off of [0, 0x1000]) {
    if (off + 32 > otadata.length) continue
    const seq = u32le(otadata, off)
    if (seq === 0xffffffff || seq === 0) continue
    const state = u32le(otadata, off + 24)
    if (state === OTA_IMG_INVALID || state === OTA_IMG_ABORTED) continue
    if (crc32(otadata.subarray(off, off + 4), 0xffffffff) !== u32le(otadata, off + 28)) continue
    if (best === null || seq > best) best = seq
  }
  return best
}

/** Раздел, который загрузит загрузчик ESP-IDF: по otadata, иначе factory, иначе ota_0. */
export function selectAppPartition(parts: Partition[], otadata: Uint8Array | null): Partition | null {
  const ota = parts
    .filter((p) => p.type === 0 && p.subtype >= 0x10 && p.subtype <= 0x1f)
    .sort((a, b) => a.subtype - b.subtype)
  const factory = parts.find((p) => p.type === 0 && p.subtype === 0x00) ?? null
  const seq = otadata && ota.length ? activeOtaSeq(otadata) : null
  if (seq !== null) return ota[(seq - 1) % ota.length]
  return factory ?? ota[0] ?? null
}
