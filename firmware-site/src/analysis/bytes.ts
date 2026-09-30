/** Мелкие помощники для разбора двоичных форматов прошивок. */

export function u16le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8)
}

export function u32le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}

/** Строка фиксированной длины, обрезанная по первому нулю (как char[] в C). */
export function cString(b: Uint8Array, o: number, max: number): string {
  let end = o
  while (end < o + max && end < b.length && b[end] !== 0) end++
  return new TextDecoder().decode(b.subarray(o, end))
}

export function hexAddr(n: number, width = 8): string {
  return '0x' + n.toString(16).toUpperCase().padStart(width, '0')
}

export function hexBytes(b: ArrayLike<number>): string {
  return Array.from(b, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

const sizeFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} КБ`
  return `${sizeFormat.format(bytes / 1024 / 1024)} МБ`
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

export function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Копия в отдельный ArrayBuffer — для Web Crypto, Blob и spark-md5. */
export function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  return b.slice().buffer as ArrayBuffer
}
