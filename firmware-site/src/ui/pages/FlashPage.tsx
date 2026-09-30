import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Info, RefreshCw, Upload } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatSize, hexAddr } from '@/analysis/bytes'
import type { Partition } from '@/analysis/partitions'
import type { ExplainedError } from '@/drivers/explainError'
import type { BoardDriver } from '@/drivers/types'
import { checkCompatibility } from '@/flash/compat'
import { type FirmwareRecord, getFirmwareData, kindLabel, listFirmware } from '@/library/library'
import { useConnection } from '@/state/ConnectionContext'
import { ErrorCallout } from '../components/ErrorCallout'
import { OperationProgress } from '../components/OperationProgress'
import { Panel } from '../components/Panel'
import { StatusDot } from '../components/StatusDot'
import { formatDate } from '../library/downloadRecord'
import { ImportButton } from '../library/ImportButton'

interface BoardLayout {
  partitions: Partition[]
  activeApp: Partition | null
}

export function FlashPage({ id }: { id: number | null }) {
  const { status, op, run, disconnect } = useConnection()
  const driver = status.kind === 'connected' ? status.driver : null
  const portLabel = status.kind === 'connected' ? status.portLabel : ''
  const currentDriver = useRef<BoardDriver | null>(null)
  currentDriver.current = driver
  const records = useLiveQuery(listFirmware, [], [] as FirmwareRecord[])
  const [selectedId, setSelectedId] = useState<number | null>(id)
  const record = records.find((r) => r.id === selectedId) ?? null
  const [layout, setLayout] = useState<BoardLayout | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<ExplainedError | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // У ESP32 адрес записи приложения и раздела берётся из таблицы разделов платы-получателя.
  const loadLayout = useCallback(() => {
    setLayout(null)
    if (!driver || driver.info.family !== 'esp32') return
    void run(
      'Читаю разделы платы',
      async (d) => ({
        partitions: await (d.readPartitionTable?.() ?? Promise.resolve([] as Partition[])).catch(() => [] as Partition[]),
        activeApp: await (d.activeAppPartition?.() ?? Promise.resolve(null)).catch(() => null),
      }),
      { cancellable: false },
    ).then((r) => {
      if (currentDriver.current === driver && r.ok) setLayout(r.value)
    })
  }, [driver, run])

  useEffect(loadLayout, [loadLayout])

  const compat =
    record && driver
      ? checkCompatibility({ firmware: record, board: driver.info, partitions: layout?.partitions, activeApp: layout?.activeApp })
      : null

  function select(value: string) {
    setSelectedId(Number(value))
    setDone(null)
    setError(null)
  }

  async function onFlash() {
    setConfirmOpen(false)
    setError(null)
    setDone(null)
    if (!record || !compat?.ok) return
    const blob = await getFirmwareData(record.id)
    if (!blob) {
      setError({ title: 'Прошивка не найдена в Библиотеке', raw: '' })
      return
    }
    const r = await run('Заливка прошивки', (d, p, s) => d.write(blob.data, compat.address, p, s))
    if (!r.ok) {
      if (!r.error.silent) setError(r.error)
      return
    }
    setDone(`Прошивка «${record.name}» записана и проверена. Плата перезагружена и работает с новой прошивкой.`)
    await disconnect() // ESP32 выходит из загрузчика только по сбросу; Arduino — отпускаем порт
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-medium">Заливка</h1>

      <Panel title="Что заливаем">
        <div className="flex flex-wrap items-start gap-3">
          <Select value={selectedId === null ? '' : String(selectedId)} onValueChange={select}>
            <SelectTrigger className="w-full sm:w-[28rem]">
              <SelectValue placeholder="Выберите прошивку из Библиотеки" />
            </SelectTrigger>
            <SelectContent>
              {records.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.name} · {r.chip} · {kindLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ImportButton onImported={(rec) => select(String(rec.id))} />
        </div>
        {record && (
          <div className="mt-3 text-sm text-muted-foreground">
            {record.chip} · {kindLabel(record)} · {formatSize(record.size)} · {formatDate(record.createdAt)}
            <div className="break-all">SHA-256: {record.sha256}</div>
          </div>
        )}
      </Panel>

      <Panel title="Куда">
        {driver ? (
          <div className="flex items-start gap-3">
            <StatusDot tone="ok" className="mt-1.5" />
            <div>
              <div className="font-medium">
                {driver.info.chip} · {formatSize(driver.info.flashSize)} flash
              </div>
              <div className="text-sm text-muted-foreground">{portLabel}</div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <StatusDot tone="idle" />
            <span className="text-sm">Плата не подключена.</span>
            <Button variant="outline" asChild>
              <a href="#/device">Подключить плату</a>
            </Button>
          </div>
        )}
      </Panel>

      {record && driver && compat && (
        <Panel title="Проверка">
          {compat.ok ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <StatusDot tone="ok" /> Совместимо: запись с адреса {hexAddr(compat.address)}
              </div>
              {compat.warnings.map((w) => (
                <div key={w} className="flex gap-2 text-sm text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  {w}
                </div>
              ))}
            </div>
          ) : (
            <ErrorCallout error={{ title: 'Залить нельзя', hint: compat.reason }} />
          )}
          {driver.info.family === 'esp32' && layout === null && op === null && record.kind !== 'full' && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={loadLayout}>
              <RefreshCw className="size-4" /> Перечитать разделы платы
            </Button>
          )}
          <div className="mt-4">
            <Button onClick={() => setConfirmOpen(true)} disabled={!compat.ok || op !== null}>
              <Upload className="size-4" /> Залить
            </Button>
          </div>
          <OperationProgress className="mt-4" />
          {error && <ErrorCallout error={error} className="mt-4" />}
        </Panel>
      )}

      {done && (
        <Panel title="Готово">
          <div className="flex items-start gap-3">
            <StatusDot tone="ok" className="mt-1.5" />
            <div className="text-sm">{done}</div>
          </div>
        </Panel>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Данные на плате будут перезаписаны</AlertDialogTitle>
            <AlertDialogDescription>
              {record && driver && compat?.ok
                ? `Запишу «${record.name}» (${formatSize(record.size)}) с адреса ${hexAddr(compat.address)} на ${driver.info.chip}. Если запись прервётся, плата может не запуститься — тогда просто залейте прошивку ещё раз.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onFlash()}>Залить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
