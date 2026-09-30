import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { hexAddr } from '@/analysis/bytes'

const hex2 = (b: number) => b.toString(16).toUpperCase().padStart(2, '0')
const ascii = (b: number) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·')

/** Виртуальная прокрутка: в DOM только видимые строки, поэтому 16 МБ открываются мгновенно. */
export function HexView({ data, baseAddress, highlight }: { data: Uint8Array; baseAddress: number; highlight: { address: number; length: number } | null }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const rows = Math.ceil(data.length / 16)
  const virtualizer = useVirtualizer({ count: rows, getScrollElement: () => parentRef.current, estimateSize: () => 24, overscan: 20 })
  const [target, setTarget] = useState('')
  const [targetError, setTargetError] = useState('')

  useEffect(() => {
    if (highlight) virtualizer.scrollToIndex(Math.floor((highlight.address - baseAddress) / 16), { align: 'center' })
  }, [highlight, baseAddress, virtualizer])

  function jump() {
    const n = parseInt(target.trim().replace(/^0x/i, ''), 16)
    const row = Math.floor((n - baseAddress) / 16)
    if (Number.isNaN(n) || row < 0 || row >= rows) {
      setTargetError(`Адрес вне дампа: ${hexAddr(baseAddress)} … ${hexAddr(baseAddress + data.length - 1)}`)
      return
    }
    setTargetError('')
    virtualizer.scrollToIndex(row, { align: 'start' })
  }

  const hiStart = highlight ? highlight.address - baseAddress : -1
  const hiEnd = highlight ? hiStart + highlight.length : -1

  return (
    <div>
      <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); jump() }}>
        <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Адрес, например 0x8000" className="sm:max-w-xs" />
        <Button type="submit" variant="outline">Перейти</Button>
      </form>
      {targetError && <div className="mb-2 text-xs text-err">{targetError}</div>}
      <div ref={parentRef} className="h-[60vh] overflow-auto rounded-[10px] border font-mono text-xs">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const off = item.index * 16
            const bytes = data.subarray(off, off + 16)
            return (
              <div key={item.key} className="absolute left-0 top-0 flex w-full gap-4 px-3 leading-6 whitespace-pre" style={{ transform: `translateY(${item.start}px)` }}>
                <span className="text-muted-foreground">{hexAddr(baseAddress + off)}</span>
                <span>
                  {Array.from(bytes, (b, i) => (
                    <span key={i} className={off + i >= hiStart && off + i < hiEnd ? 'rounded-sm bg-data/25' : undefined}>
                      {hex2(b)}{i === 7 ? '  ' : ' '}
                    </span>
                  ))}
                </span>
                <span className="hidden text-muted-foreground sm:inline">{Array.from(bytes, ascii).join('')}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
