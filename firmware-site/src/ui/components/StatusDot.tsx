import { cn } from '@/lib/utils'

export type Tone = 'ok' | 'warn' | 'err' | 'idle' | 'data'

const TONE_CLASS: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err', idle: 'bg-idle', data: 'bg-data' }

export function StatusDot({ tone, pulse = false, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2.5 shrink-0', className)} aria-hidden>
      {pulse && <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', TONE_CLASS[tone])} />}
      <span className={cn('relative inline-flex size-2.5 rounded-full', TONE_CLASS[tone])} />
    </span>
  )
}
