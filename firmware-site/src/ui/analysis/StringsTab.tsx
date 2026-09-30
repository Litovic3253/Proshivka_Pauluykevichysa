import { useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { hexAddr } from '@/analysis/bytes'
import { extractStrings } from '@/analysis/strings'
import { Panel } from '../components/Panel'

const SHOW_LIMIT = 1000

export function StringsTab({ data, baseAddress, onJump }: { data: Uint8Array; baseAddress: number; onJump: (address: number, length: number) => void }) {
  const all = useMemo(() => extractStrings(data, baseAddress), [data, baseAddress])
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? all.filter((s) => s.text.toLowerCase().includes(q)) : all
  }, [all, query])
  const encoder = useMemo(() => new TextEncoder(), [])
  return (
    <Panel title={`Строки · ${all.length}`}>
      <div className="flex flex-wrap gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск: ssid, http, версия…" className="sm:max-w-sm" />
        <Button variant="outline" onClick={() => void navigator.clipboard.writeText(filtered.map((s) => s.text).join('\n'))}>
          <Copy className="size-4" /> Копировать
        </Button>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {filtered.length > SHOW_LIMIT ? `Показаны первые ${SHOW_LIMIT} из ${filtered.length} — уточните поиск` : `Найдено: ${filtered.length}`}
      </div>
      <ul className="mt-2 max-h-[60vh] divide-y overflow-auto rounded-[10px] border text-sm">
        {filtered.slice(0, SHOW_LIMIT).map((s) => (
          <li key={s.address} className="flex gap-3 px-3 py-1.5">
            <button
              type="button"
              className="shrink-0 font-mono text-xs text-data hover:underline"
              title="Показать в HEX"
              onClick={() => onJump(s.address, encoder.encode(s.text).length)}
            >
              {hexAddr(s.address)}
            </button>
            <span className="min-w-0 break-all">{s.text}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
