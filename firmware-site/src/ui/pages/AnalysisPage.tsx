import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Save, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { analyzeFirmware } from '@/analysis/analyze'
import { formatSize, hexAddr } from '@/analysis/bytes'
import { explainError, type ExplainedError } from '@/drivers/explainError'
import { type FirmwareRecord, getFirmware, getFirmwareData, kindLabel, MISSING_FILE, showFirmwareInFolder } from '@/library/library'
import { useLibrary } from '@/library/useLibrary'
import { HexView } from '../analysis/HexView'
import { PartitionsTab } from '../analysis/PartitionsTab'
import { StringsTab } from '../analysis/StringsTab'
import { SummaryTab } from '../analysis/SummaryTab'
import { ErrorCallout } from '../components/ErrorCallout'
import { Panel } from '../components/Panel'
import { formatDate, saveRecordAs } from '../library/recordFiles'

type Loaded = { record: FirmwareRecord; data: Uint8Array } | 'missing' | 'no-file' | null

function Picker() {
  const records = useLibrary()
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-medium">Анализ</h1>
      <Panel title="Выберите прошивку">
        {records.length === 0 ? (
          <p className="text-sm text-muted-foreground">Библиотека пуста. Считайте плату на экране «Устройство» или загрузите файл в «Библиотеке».</p>
        ) : (
          <ul className="divide-y">
            {records.map((r) => (
              <li key={r.id}>
                <a href={`#/analysis/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:text-primary">
                  <span className="font-medium break-all">{r.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.chip} · {kindLabel(r)} · {formatSize(r.size)} · {formatDate(r.createdAt)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function AnalysisView({ record, data }: { record: FirmwareRecord; data: Uint8Array }) {
  const analysis = useMemo(() => analyzeFirmware(record, data), [record, data])
  const [tab, setTab] = useState('summary')
  const [highlight, setHighlight] = useState<{ address: number; length: number } | null>(null)
  const [error, setError] = useState<ExplainedError | null>(null)
  const act = (fn: () => Promise<void>) => void fn().then(() => setError(null), (e) => setError(explainError(e)))
  const flashSize =
    analysis.bootloader?.flashSizeBytes ??
    Math.max(record.baseAddress + record.size, ...analysis.partitions.map((p) => p.offset + p.size))
  const jump = (address: number, length: number) => {
    setHighlight({ address, length })
    setTab('hex')
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-medium break-all">{record.name}</h1>
          <div className="text-sm text-muted-foreground">
            {record.chip} · {kindLabel(record)} · {formatSize(record.size)} · с адреса {hexAddr(record.baseAddress)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => act(() => saveRecordAs(record, 'bin'))}>
            <Save className="size-4" /> .bin
          </Button>
          {record.family === 'avr' && (
            <Button variant="outline" onClick={() => act(() => saveRecordAs(record, 'hex'))}>.hex</Button>
          )}
          <Button variant="outline" onClick={() => act(() => showFirmwareInFolder(record.id))}>
            <FolderOpen className="size-4" /> Показать в папке
          </Button>
          <Button asChild>
            <a href={`#/flash/${record.id}`}>
              <Upload className="size-4" /> Залить
            </a>
          </Button>
        </div>
      </div>
      {error && <ErrorCallout error={error} />}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="summary">Сводка</TabsTrigger>
          {analysis.partitions.length > 0 && <TabsTrigger value="partitions">Разделы</TabsTrigger>}
          <TabsTrigger value="strings">Строки</TabsTrigger>
          <TabsTrigger value="hex">HEX</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="mt-4">
          <SummaryTab record={record} analysis={analysis} />
        </TabsContent>
        {analysis.partitions.length > 0 && (
          <TabsContent value="partitions" className="mt-4">
            <PartitionsTab partitions={analysis.partitions} flashSize={flashSize} />
          </TabsContent>
        )}
        <TabsContent value="strings" className="mt-4">
          <StringsTab data={data} baseAddress={record.baseAddress} onJump={jump} />
        </TabsContent>
        <TabsContent value="hex" className="mt-4">
          <Panel title="HEX">
            <HexView data={data} baseAddress={record.baseAddress} highlight={highlight} />
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function AnalysisPage({ id }: { id: number | null }) {
  const [loaded, setLoaded] = useState<Loaded>(null)
  useEffect(() => {
    if (id === null) return
    let active = true
    void Promise.all([getFirmware(id), getFirmwareData(id)]).then(([record, blob]) => {
      if (active) setLoaded(!record ? 'missing' : !blob ? 'no-file' : { record, data: blob.data })
    })
    return () => {
      active = false
    }
  }, [id])

  if (id === null) return <Picker />
  if (loaded === null) return <Panel title="Анализ">Загружаю…</Panel>
  if (loaded === 'no-file') {
    return (
      <Panel title="Анализ">
        <p className="text-sm">{MISSING_FILE}.</p>
      </Panel>
    )
  }
  if (loaded === 'missing') {
    return (
      <Panel title="Анализ">
        <p className="text-sm">
          Прошивка не найдена — возможно, её удалили.{' '}
          <a href="#/library" className="underline">Открыть Библиотеку</a>
        </p>
      </Panel>
    )
  }
  return <AnalysisView record={loaded.record} data={loaded.data} />
}
