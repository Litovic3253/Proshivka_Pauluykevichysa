import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Карточка-виджет Студии: радиус 20, тонкая рамка, почти незаметная тень, глубокая — при наведении. */
export function Panel({ title, actions, className, children }: { title?: string; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        'rounded-[20px] border bg-card p-5 text-card-foreground shadow-[0_1px_2px_rgba(0,0,0,0.10)] transition-shadow duration-200 hover:shadow-[0_14px_28px_-10px_rgba(0,0,0,0.28)]',
        className,
      )}
    >
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}
