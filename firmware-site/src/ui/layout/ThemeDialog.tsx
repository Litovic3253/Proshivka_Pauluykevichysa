import { Check } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { type Palette, PALETTES, SYSTEM_THEME, SYSTEM_THEME_NAME } from '../theme/palettes'
import { useTheme } from '../theme/theme'

function Preview({ pal }: { pal: Palette }) {
  return (
    <div className="space-y-1.5 p-3" style={{ background: pal.bg }}>
      <div className="h-1.5 w-2/3 rounded-full" style={{ background: pal.syntax[0] }} />
      <div className="h-1.5 w-1/2 rounded-full" style={{ background: pal.syntax[1] }} />
      <div className="h-1.5 w-3/4 rounded-full" style={{ background: pal.syntax[2] }} />
      <div className="h-4 rounded-md" style={{ background: pal.card, border: `1px solid ${pal.border}` }} />
    </div>
  )
}

export function ThemeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [current, choose] = useTheme()
  const options = [
    { key: SYSTEM_THEME, name: SYSTEM_THEME_NAME, pal: null as Palette | null },
    ...Object.entries(PALETTES).map(([key, pal]) => ({ key, name: pal.name, pal })),
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[20px] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Тема</DialogTitle>
          <DialogDescription>Как темы редактора в VS Code. Выбор запоминается в этом браузере.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {options.map(({ key, name, pal }) => (
            <button key={key} type="button" onClick={() => choose(key)}
              className={cn('rounded-[14px] border p-2 text-left transition-shadow hover:shadow-md', current === key && 'ring-2 ring-ring')}>
              <div className="overflow-hidden rounded-[10px]">
                {pal ? <Preview pal={pal} /> : (
                  <div className="grid grid-cols-2">
                    <Preview pal={PALETTES.light} />
                    <Preview pal={PALETTES.dark} />
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{name}</span>
                {current === key && <Check className="size-3.5 shrink-0" />}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
