import { useEffect, useState, useSyncExternalStore } from 'react'
import { Usb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { describeElectronPort } from '@/serial/portName'
import { choosePort, getPickerPorts, initPortPicker, subscribePicker } from '@/state/portPicker'
import { StatusDot } from '../components/StatusDot'

export function PortPickerDialog() {
  useEffect(() => initPortPicker(), [])
  const ports = useSyncExternalStore(subscribePicker, getPickerPorts)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!ports) setSelected(null)
    else if (ports.length === 1) setSelected(ports[0].portId)
    else if (selected && !ports.some((p) => p.portId === selected)) setSelected(null)
  }, [ports, selected])

  const confirm = () => choosePort(ports?.find((p) => p.portId === selected) ?? null)

  return (
    <Dialog open={ports !== null} onOpenChange={(open) => !open && choosePort(null)}>
      <DialogContent className="rounded-[20px]">
        <DialogHeader>
          <DialogTitle>Выберите порт</DialogTitle>
          <DialogDescription>Список обновляется сам, когда плату подключают или отключают.</DialogDescription>
        </DialogHeader>
        {ports && ports.length === 0 ? (
          <div className="flex items-center gap-3 rounded-[10px] border p-4 text-sm text-muted-foreground">
            <Usb className="size-4 shrink-0" /> Подключите плату по USB — она появится здесь.
          </div>
        ) : (
          <div className="grid gap-1.5" role="listbox" aria-label="Порты">
            {ports?.map((p) => (
              <button
                key={p.portId}
                type="button"
                role="option"
                aria-selected={selected === p.portId}
                onClick={() => setSelected(p.portId)}
                onDoubleClick={() => choosePort(p)}
                className={cn('flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent', selected === p.portId && 'border-ring bg-accent')}
              >
                <StatusDot tone={selected === p.portId ? 'ok' : 'idle'} />
                <span className="min-w-0 break-words">{describeElectronPort(p)}</span>
              </button>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => choosePort(null)}>Отмена</Button>
          <Button onClick={confirm} disabled={!selected}>Выбрать</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
