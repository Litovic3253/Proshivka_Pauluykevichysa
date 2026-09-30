import type { ExplainedError } from '@/drivers/explainError'
import { cn } from '@/lib/utils'
import { StatusDot } from './StatusDot'

export function ErrorCallout({ error, tone = 'err', className }: { error: Pick<ExplainedError, 'title' | 'hint'>; tone?: 'err' | 'warn'; className?: string }) {
  return (
    <div
      role={tone === 'err' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-[10px] border p-3 text-sm', tone === 'err' ? 'border-err/40 bg-err/5' : 'border-warn/40 bg-warn/5', className)}
    >
      <StatusDot tone={tone} className="mt-1.5" />
      <div className="min-w-0">
        <div className="font-medium break-words">{error.title}</div>
        {error.hint && <div className="mt-0.5 text-muted-foreground">{error.hint}</div>}
      </div>
    </div>
  )
}
