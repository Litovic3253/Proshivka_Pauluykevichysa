/** Intel HEX — формат, в котором Arduino IDE и avrdude сохраняют прошивки. */

export interface HexImage {
  data: Uint8Array
  baseAddress: number
}

const MAX_IMAGE = 64 * 1024 * 1024

export function parseIntelHex(text: string): HexImage {
  const chunks: { addr: number; bytes: Uint8Array }[] = []
  let upper = 0
  const lines = text.split(/\r?\n/)
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim()
    if (!line) continue
    const where = `Строка ${n + 1}`
    if (line[0] !== ':' || line.length < 11 || (line.length - 1) % 2 !== 0 || !/^:[0-9A-Fa-f]+$/.test(line)) {
      throw new Error(`${where}: это не Intel HEX`)
    }
    const raw = new Uint8Array((line.length - 1) / 2)
    for (let i = 0; i < raw.length; i++) raw[i] = parseInt(line.substr(1 + i * 2, 2), 16)
    const len = raw[0]
    if (raw.length !== len + 5) throw new Error(`${where}: неверная длина записи`)
    let sum = 0
    for (const b of raw) sum = (sum + b) & 0xff
    if (sum !== 0) throw new Error(`${where}: неверная контрольная сумма`)
    const addr = (raw[1] << 8) | raw[2]
    const type = raw[3]
    const payload = raw.subarray(4, 4 + len)
    if (type === 0x00) chunks.push({ addr: upper + addr, bytes: payload.slice() })
    else if (type === 0x01) break
    else if (type === 0x02) upper = ((payload[0] << 8) | payload[1]) * 16
    else if (type === 0x04) upper = ((payload[0] << 8) | payload[1]) * 0x10000
    // 0x03 и 0x05 — адрес запуска, для заливки не нужен
  }
  if (!chunks.length) throw new Error('В файле нет данных')
  let base = Infinity
  let end = 0
  for (const c of chunks) {
    base = Math.min(base, c.addr)
    end = Math.max(end, c.addr + c.bytes.length)
  }
  if (end - base > MAX_IMAGE) throw new Error('Слишком большой диапазон адресов в HEX-файле')
  const data = new Uint8Array(end - base).fill(0xff)
  for (const c of chunks) data.set(c.bytes, c.addr - base)
  return { data, baseAddress: base }
}

function record(type: number, addr: number, bytes: ArrayLike<number>): string {
  const raw = [bytes.length, (addr >> 8) & 0xff, addr & 0xff, type, ...Array.from(bytes)]
  const sum = raw.reduce((a, b) => a + b, 0)
  raw.push((0x100 - (sum & 0xff)) & 0xff)
  return ':' + raw.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('')
}

/** Записи из одних 0xFF пропускаются — это стёртая flash, при разборе они восстанавливаются. */
export function formatIntelHex(data: Uint8Array, baseAddress = 0): string {
  const lines: string[] = []
  let upper = 0
  for (let off = 0; off < data.length; off += 16) {
    const chunk = data.subarray(off, Math.min(off + 16, data.length))
    if (chunk.every((b) => b === 0xff)) continue
    const addr = baseAddress + off
    const hi = Math.floor(addr / 0x10000)
    if (hi !== upper) {
      lines.push(record(0x04, 0, [hi >> 8, hi & 0xff]))
      upper = hi
    }
    lines.push(record(0x00, addr & 0xffff, chunk))
  }
  lines.push(record(0x01, 0, []))
  return lines.join('\r\n') + '\r\n'
}
