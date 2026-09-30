import type { ReactNode } from 'react'
import { Panel } from './Panel'

/** Мелкий заголовок капсом и крупная цифра — как виджеты статистики в Студии. */
export function StatCard({ title, value, sub, children }: { title: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <Panel title={title}>
      <div className="text-2xl font-medium tracking-tight">{value}</div>
      {children}
      {sub && <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>}
    </Panel>
  )
}

export function UsageBar({ percent }: { percent: number }) {
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-data transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  )
}
