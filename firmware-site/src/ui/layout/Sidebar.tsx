import { Cpu, FileSearch, Library, Palette, Upload, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type ConnStatus, useConnection } from '@/state/ConnectionContext'
import { StatusDot, type Tone } from '../components/StatusDot'
import type { Route } from '../routing'

const ITEMS: { page: Route['page']; label: string; icon: LucideIcon; href: string }[] = [
  { page: 'device', label: 'Устройство', icon: Cpu, href: '#/device' },
  { page: 'library', label: 'Библиотека', icon: Library, href: '#/library' },
  { page: 'analysis', label: 'Анализ', icon: FileSearch, href: '#/analysis' },
  { page: 'flash', label: 'Заливка', icon: Upload, href: '#/flash' },
]

const itemClass = 'flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors hover:bg-accent'

function statusShort(status: ConnStatus): { tone: Tone; text: string } {
  switch (status.kind) {
    case 'idle': return { tone: 'idle', text: 'Плата не подключена' }
    case 'detecting': return { tone: 'warn', text: 'Определяю плату…' }
    case 'connected': return { tone: 'ok', text: status.driver.info.chip }
    case 'error': return { tone: 'err', text: status.error.title }
  }
}

/** Меню как в Студии: на широком окне — иконки с подписями, уже 900 px — только иконки. */
export function Sidebar({ route, onTheme }: { route: Route; onTheme: () => void }) {
  const { status } = useConnection()
  const short = statusShort(status)
  return (
    <nav className="sticky top-0 flex h-screen w-[72px] shrink-0 flex-col gap-1 border-r bg-card px-2.5 py-3 min-[900px]:w-[276px] min-[900px]:px-3">
      <a href="#/device" className="mb-4 flex items-center gap-3 px-1.5 py-1">
        <img src="/icon.png" alt="" className="size-9 rounded-[10px]" />
        <span className="hidden leading-tight min-[900px]:block">
          <span className="block text-sm font-medium">Прошивки</span>
          <span className="block text-xs text-muted-foreground">Паулюкевичуса</span>
        </span>
      </a>
      {ITEMS.map(({ page, label, icon: Icon, href }) => (
        <a key={page} href={href} title={label} aria-current={route.page === page ? 'page' : undefined}
          className={cn(itemClass, route.page === page && 'bg-accent font-medium')}>
          <Icon className="size-4 shrink-0" />
          <span className="hidden min-[900px]:inline">{label}</span>
        </a>
      ))}
      <div className="mt-auto space-y-1">
        <a href="#/device" title={short.text} className={itemClass}>
          <StatusDot tone={short.tone} pulse={status.kind === 'detecting'} className="mx-[3px]" />
          <span className="hidden truncate text-muted-foreground min-[900px]:inline">{short.text}</span>
        </a>
        <button type="button" onClick={onTheme} title="Тема" className={cn(itemClass, 'w-full')}>
          <Palette className="size-4 shrink-0" />
          <span className="hidden min-[900px]:inline">Тема</span>
        </button>
      </div>
    </nav>
  )
}
