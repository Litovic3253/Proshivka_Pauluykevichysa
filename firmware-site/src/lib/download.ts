import { toArrayBuffer } from '@/analysis/bytes'

export function downloadBytes(data: Uint8Array | string, filename: string): void {
  const blob =
    typeof data === 'string'
      ? new Blob([data], { type: 'text/plain' })
      : new Blob([toArrayBuffer(data)], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
