import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useConnection } from '@/state/ConnectionContext'

export function LogPanel() {
  const { log, clearLog } = useConnection()
  const [copied, setCopied] = useState(false)
  if (!log.length) return null
  const copy = async () => {
    await navigator.clipboard.writeText(log.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <details className="rounded-[20px] border bg-card p-4 text-sm">
      <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Журнал · {log.length}
      </summary>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          {copied ? 'Скопировано' : 'Копировать'}
        </Button>
        <Button size="sm" variant="ghost" onClick={clearLog}>
          Очистить
        </Button>
      </div>
      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[10px] bg-muted p-3 text-xs">{log.join('\n')}</pre>
    </details>
  )
}
