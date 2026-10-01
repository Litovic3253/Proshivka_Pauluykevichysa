import { useEffect, useState, type ReactNode } from 'react'
import { FileSearch, FolderOpen, Pencil, Save, Trash2, Upload } from 'lucide-react'
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
import { explainError, type ExplainedError } from '@/drivers/explainError'
import {
  deleteFirmware,
  type FirmwareRecord,
  kindLabel,
  libraryFolder,
  NO_TRASH,
  openLibraryFolder,
  showFirmwareInFolder,
  updateFirmware,
} from '@/library/library'
import { useLibraryState } from '@/library/useLibrary'
import { ErrorCallout } from '../components/ErrorCallout'
import { Panel } from '../components/Panel'
import { formatDate, saveRecordAs } from '../library/recordFiles'
import { ImportButton } from '../library/ImportButton'

function EditDialog({ record, onClose }: { record: FirmwareRecord | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<ExplainedError | null>(null)
  useEffect(() => {
    if (record) {
      setName(record.name)
      setNote(record.note)
      setError(null)
    }
  }, [record])
  async function save() {
    if (!record) return
    try {
      await updateFirmware(record.id, { name: name.trim() || record.name, note })
      onClose()
    } catch (e) {
      setError(explainError(e))
    }
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
          {error && <ErrorCallout error={error} />}
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
  const { records, error: listError } = useLibraryState()
  const [folder, setFolder] = useState<{ path: string; bytes: number; count: number } | null>(null)
  const [editing, setEditing] = useState<FirmwareRecord | null>(null)
  const [deleting, setDeleting] = useState<FirmwareRecord | null>(null)
  const [deletingForever, setDeletingForever] = useState<FirmwareRecord | null>(null)
  const [error, setError] = useState<ExplainedError | null>(null)
  const act = (fn: () => Promise<void>) => void fn().then(() => setError(null), (e) => setError(explainError(e)))

  useEffect(() => {
    void libraryFolder().then(setFolder, () => setFolder(null))
  }, [records])

  /** На флешке и в сетевой папке Корзины нет — тогда спрашиваем про удаление навсегда. */
  async function remove(rec: FirmwareRecord) {
    try {
      await deleteFirmware(rec.id)
      setError(null)
    } catch (e) {
      const explained = explainError(e)
      if (explained.title.startsWith(NO_TRASH)) setDeletingForever(rec)
      else setError(explained)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-medium">Библиотека</h1>
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="outline" onClick={() => act(openLibraryFolder)}>
            <FolderOpen className="size-4" /> Открыть папку
          </Button>
          <ImportButton />
        </div>
      </div>
      {listError && (
        <ErrorCallout error={{ title: 'Не удалось прочитать библиотеку', hint: `${listError.title}. Прошивки на диске не тронуты.` }} />
      )}
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
                      <Button variant="ghost" size="icon" title="Сохранить .bin как…" aria-label="Сохранить .bin как…" onClick={() => act(() => saveRecordAs(r, 'bin'))}>
                        <Save className="size-4" />
                      </Button>
                      {r.family === 'avr' && (
                        <Button variant="ghost" size="sm" title="Сохранить .hex как…" onClick={() => act(() => saveRecordAs(r, 'hex'))}>
                          HEX
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" title="Показать в папке" aria-label="Показать в папке" onClick={() => act(() => showFirmwareInFolder(r.id))}>
                        <FolderOpen className="size-4" />
                      </Button>
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
        {error && <ErrorCallout error={error} className="mt-4" />}
      </Panel>
      {folder && (
        <p className="text-xs break-all text-muted-foreground">
          Папка: {folder.path} · {folder.count} прошивок · {formatSize(folder.bytes)}. Файлы можно копировать и переносить вместе с программой.
        </p>
      )}
      <EditDialog record={editing} onClose={() => setEditing(null)} />
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить «{deleting?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>Запись исчезнет из Библиотеки, файлы прошивки уйдут в Корзину Windows.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && void remove(deleting)}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deletingForever !== null} onOpenChange={(open) => !open && setDeletingForever(null)}>
        <AlertDialogContent className="rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Корзина недоступна</AlertDialogTitle>
            <AlertDialogDescription>
              «{deletingForever?.name}» нельзя отправить в Корзину — так бывает на флешке, в сетевой папке или если файл занят. Удалить файл навсегда?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => deletingForever && act(() => deleteFirmware(deletingForever.id, true))}>Удалить навсегда</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
