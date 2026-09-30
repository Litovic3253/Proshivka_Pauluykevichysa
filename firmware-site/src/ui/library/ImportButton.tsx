import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { explainError, type ExplainedError } from '@/drivers/explainError'
import type { Family } from '@/drivers/types'
import { type IdentifiedFile, identifyFile, MANUAL_CHIPS } from '@/library/identify'
import { type FirmwareRecord, saveFirmware } from '@/library/library'
import { ErrorCallout } from '../components/ErrorCallout'

const chipTitle = (chip: string) => (chip === 'ATmega328P' ? 'Arduino Uno / Nano / Pro Mini (ATmega328P)' : chip)

export function ImportButton({ onImported }: { onImported?: (rec: FirmwareRecord) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<IdentifiedFile | null>(null)
  const [chip, setChip] = useState(MANUAL_CHIPS[0].chip)
  const [error, setError] = useState<ExplainedError | null>(null)

  async function save(f: IdentifiedFile, family: Family, chipName: string) {
    try {
      const rec = await saveFirmware({
        name: f.name,
        family,
        chip: chipName,
        kind: f.kind,
        baseAddress: f.baseAddress,
        data: f.data,
        source: 'file',
        appName: f.appName,
        appVersion: f.appVersion,
      })
      onImported?.(rec)
    } catch (e) {
      setError(explainError(e))
    }
  }

  async function onFile(file: File) {
    setError(null)
    try {
      const f = identifyFile(file.name, new Uint8Array(await file.arrayBuffer()))
      if (f.family && f.chip) await save(f, f.family, f.chip)
      else setPending(f)
    } catch (e) {
      setError(explainError(e))
    }
  }

  async function confirmChip() {
    const f = pending
    const choice = MANUAL_CHIPS.find((c) => c.chip === chip)
    setPending(null)
    if (f && choice) await save(f, choice.family, choice.chip)
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".bin,.hex"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void onFile(file)
        }}
      />
      <Button variant="outline" onClick={() => inputRef.current?.click()}>
        <FileUp className="size-4" /> Загрузить файл
      </Button>
      {error && <ErrorCallout error={error} />}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="rounded-[20px]">
          <DialogHeader>
            <DialogTitle>Для какой платы этот файл?</DialogTitle>
            <DialogDescription>
              По содержимому «{pending?.name}» чип не определить. От выбора зависит, на какие платы файл можно будет залить.
            </DialogDescription>
          </DialogHeader>
          <Select value={chip} onValueChange={setChip}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MANUAL_CHIPS.map((c) => (
                <SelectItem key={c.chip} value={c.chip}>
                  {chipTitle(c.chip)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Отмена
            </Button>
            <Button onClick={() => void confirmChip()}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
