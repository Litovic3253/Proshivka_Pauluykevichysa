export interface Usage {
  used: number
  free: number
  total: number
  percent: number
}

/**
 * Занято = блоки, в которых есть хоть один байт не 0xFF. Разделы ESP32 разбросаны по flash,
 * поэтому считать «до последнего непустого байта» нельзя — SPIFFS в конце дал бы 100 %.
 */
export function usage(data: Uint8Array, blockSize: number): Usage {
  let used = 0
  for (let start = 0; start < data.length; start += blockSize) {
    const end = Math.min(start + blockSize, data.length)
    for (let i = start; i < end; i++) {
      if (data[i] !== 0xff) {
        used += end - start
        break
      }
    }
  }
  const total = data.length
  return { used, free: total - used, total, percent: total ? Math.round((used / total) * 100) : 0 }
}
