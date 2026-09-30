export interface FoundString {
  address: number
  text: string
}

/** Длина печатного символа в байтах (ASCII или UTF-8 до 3 байт) или 0, если это не текст. */
function charLength(b: Uint8Array, i: number): number {
  const c = b[i]
  if (c === undefined) return 0
  if ((c >= 0x20 && c < 0x7f) || c === 0x09) return 1
  const cont = (k: number) => i + k < b.length && (b[i + k] & 0xc0) === 0x80
  if (c >= 0xc2 && c <= 0xdf && cont(1)) return 2
  if (c >= 0xe0 && c <= 0xef && cont(1) && cont(2)) return 3
  return 0
}

export function extractStrings(data: Uint8Array, baseAddress = 0, minLength = 5, limit = 100_000): FoundString[] {
  const out: FoundString[] = []
  const decoder = new TextDecoder()
  let i = 0
  while (i < data.length && out.length < limit) {
    const start = i
    let chars = 0
    for (let n = charLength(data, i); n > 0; n = charLength(data, i)) {
      i += n
      chars++
    }
    if (chars >= minLength) out.push({ address: baseAddress + start, text: decoder.decode(data.subarray(start, i)) })
    if (i === start) i++
  }
  return out
}
