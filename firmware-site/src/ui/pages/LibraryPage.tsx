import { useEffect, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, FileSearch, Pencil, Trash2, Upload } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { formatSize } from '@/analysis/bytes'
import { deleteFirmware, type FirmwareRecord, kindLabel, listFirmware, storageEstimate, updateFirmware } from '@/library/library'
import { Panel } from '../components/Panel'
import { downloadRecord, formatDate } from '../library/downloadRecord'
import { ImportButton } from '../library/ImportButton'

function EditDialog({ record, onClose }: { record: FirmwareRecord | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => {
    if (record) {
      setName(record.name)
      setNote(record.note)
    }
  }, [record])
  async function save() {
    if (!record) return
    await updateFirmware(record.id, { name: name.trim() || record.name, note })
    onClose()
  }
  return (
    <Dialog open={record !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-[20px]">
        <DialogHeader>
          <DialogTitle>Название и заметка</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-name">Название</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-note">Заметка</Label>
            <Textarea id="edit-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: котёл на даче, до обновления" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={() => void save()}>Сохранить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function IconLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <Button variant="ghost" size="icon" asChild>
      <a href={href} title={label} aria-label={label}>{children}</a>
    </Button>
  )
}

export function LibraryPage() {
  const records = useLiveQuery(listFirmware, [], [] as FirmwareRecord[])
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  const [editing, setEditing] = useState<FirmwareRecord | null>(null)
  const [deleting, setDeleting] = useState<FirmwareRecord | null>(null)

  useEffect(() => {
    void storageEstimate().then(setEstimate)
  }, [records])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-medium">Библиотека</h1>
        <ImportButton />
      </div>
      <Panel title={`Прошивки · ${records.length}`}>
        {records.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Здесь появятся считанные прошивки. Считайте плату на экране «Устройство» или загрузите файл .bin / .hex.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Чип</TableHead>
                <TableHead className="hidden md:table-cell">Тип</TableHead>
                <TableHead className="hidden md:table-cell">Размер</TableHead>
                <TableHead className="hidden lg:table-cell">Дата</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[260px]">
                    <div className="truncate font-medium" title={r.name}>{r.name}</div>
                    {r.note && <div className="truncate text-xs text-muted-foreground" title={r.note}>{r.note}</div>}
                  </TableCell>
                  <TableCell>{r.chip}</TableCell>
                  <TableCell className="hidden md:table-cell">{kindLabel(r)}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatSize(r.size)}</TableCell>
                  <TableCell className="hidden lg:table-cell">{formatDate(r.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon" title="Скачать .bin" aria-label="Скачать .bin" onClick={() => void downloadRecord(r, 'bin')}>
                        <Download className="size-4" />
                      </Button>
                      {r.family === 'avr' && (
                        <Button variant="ghost" size="sm" title="Скачать .hex" onClick={() => void downloadRecord(r, 'hex')}>
                          HEX
                        </Button>
                      )}
                      <IconLink href={`#/analysis/${r.id}`} label="Анализ"><FileSearch className="size-4" /></IconLink>
                      <IconLink href={`#/flash/${r.id}`} label="Залить"><Upload className="size-4" /></IconLink>
                      <Button variant="ghost" size="icon" title="Название и заметка" aria-label="Название и заметка" onClick={() => setEditing(r)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Удалить" aria-label="Удалить" onClick={() => setDeleting(r)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      {estimate && (
        <p className="text-xs text-muted-foreground">
          В браузере занято {formatSize(estimate.usage)} из {formatSize(estimate.quota)}. Прошивки хранятся только в этом браузере и никуда не отправляются.
        </p>
      )}
      <EditDialog record={editing} onClose={() => setEditing(null)} />
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить «{deleting?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>Прошивка исчезнет из Библиотеки этого браузера. Скачанные файлы останутся.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && void deleteFirmware(deleting.id)}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
