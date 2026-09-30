import { useEffect, useState } from 'react'
import { Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatSize } from '@/analysis/bytes'
import { cn } from '@/lib/utils'
import { useConnection } from '@/state/ConnectionContext'
import { etaSeconds, formatEta, percent } from '@/state/progress'

export function OperationProgress({ className }: { className?: string }) {
  const { op, cancel } = useConnection()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!op) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [op])
  if (!op) return null
  const pct = percent(op.done, op.total)
  return (
    <div className={cn('space-y-2', className)} aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{op.label}</span>
        {op.cancellable && (
          <Button size="sm" variant="outline" onClick={cancel}>
            <Square className="size-3.5" /> Стоп
          </Button>
        )}
      </div>
      <Progress value={pct} />
      <div className="text-xs text-muted-foreground">
        {op.total ? `${pct}% · ${formatSize(op.done)} из ${formatSize(op.total)}` : 'Подготовка…'}{' '}
        {formatEta(etaSeconds(op.done, op.total, op.startedAt, now))}
      </div>
    </div>
  )
}
