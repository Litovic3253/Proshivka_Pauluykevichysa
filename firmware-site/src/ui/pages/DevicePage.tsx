import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Download, FileSearch, FolderOpen, Info, Plug, RefreshCw, Save, Unplug, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { parseAppDesc } from '@/analysis/appDesc'
import { formatSize, hexAddr } from '@/analysis/bytes'
import { sha256Hex } from '@/analysis/hash'
import { formatIntelHex } from '@/analysis/intelHex'
import type { Partition } from '@/analysis/partitions'
import { type Usage, usage } from '@/analysis/usage'
import { explainError, type ExplainedError } from '@/drivers/explainError'
import type { AppInfo, BoardDriver, BoardInfo, Family, ReadTarget } from '@/drivers/types'
import { saveFile } from '@/lib/saveFile'
import { cn } from '@/lib/utils'
import { type FirmwareRecord, saveFirmware, showFirmwareInFolder, updateFirmware } from '@/library/library'
import { defaultName } from '@/library/naming'
import { type ConnStatus, useConnection } from '@/state/ConnectionContext'
import { ErrorCallout } from '../components/ErrorCallout'
import { OperationProgress } from '../components/OperationProgress'
import { Panel } from '../components/Panel'
import { StatCard, UsageBar } from '../components/StatCard'
import { StatusDot, type Tone } from '../components/StatusDot'

type Mode = 'full' | 'app' | 'partition'

interface ReadOutcome {
  record: FirmwareRecord | null
  name: string
  family: Family
  data: Uint8Array
  eeprom?: Uint8Array
  baseAddress: number
  notes: string[]
  sha256: string
  saveError?: ExplainedError
}

const BOOTLOADER_LABELS = { optiboot: 'Optiboot', atmegaboot: 'старый ATmegaBOOT', unknown: 'неизвестный' } as const

function boardLine(info: BoardInfo): string {
  return [
    info.revision ?? info.chip,
    `${formatSize(info.flashSize)} flash`,
    info.mac && `MAC ${info.mac}`,
    info.bootloader && `загрузчик ${BOOTLOADER_LABELS[info.bootloader]}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function statusView(status: ConnStatus): { tone: Tone; title: string; subtitle: string } {
  switch (status.kind) {
    case 'idle':
      return {
        tone: 'idle',
        title: 'Порт не выбран',
        subtitle: 'Подключите Arduino или ESP32 по USB и нажмите «Выбрать COM-порт». В списке портов будет видно, какой из них — плата (COM5 · CH340 и т. п.).',
      }
    case 'detecting':
      return { tone: 'warn', title: 'Определяю плату…', subtitle: status.portLabel }
    case 'connected':
      return { tone: 'ok', title: `Подключено · ${status.portLabel} · ${status.driver.info.baud} бод`, subtitle: boardLine(status.driver.info) }
    case 'error':
      return { tone: 'err', title: status.error.title, subtitle: status.portLabel ?? '' }
  }
}

function ModeOption({ value, title, hint, disabled, children }: { value: Mode; title: string; hint: string; disabled?: boolean; children?: ReactNode }) {
  return (
    <div className={cn('flex items-start gap-3', disabled && 'opacity-50')}>
      <RadioGroupItem value={value} id={`mode-${value}`} disabled={disabled} className="mt-1" />
      <div className="min-w-0 flex-1">
        <Label htmlFor={`mode-${value}`} className="font-medium">{title}</Label>
        <div className="text-xs text-muted-foreground">{hint}</div>
        {children}
      </div>
    </div>
  )
}

function AppCard({ info, appInfo }: { info: BoardInfo; appInfo: AppInfo | null }) {
  if (info.family === 'avr') return <StatCard title="Приложение" value="Скетч Arduino" sub="У AVR нет паспорта приложения — тексты из прошивки видны в Анализе" />
  const d = appInfo?.desc
  if (!d) return <StatCard title="Приложение" value="—" sub={appInfo ? `Раздел ${appInfo.partition.label}, паспорт не найден` : 'Паспорт не найден'} />
  return <StatCard title="Приложение" value={<span className="break-all">{d.projectName}</span>} sub={`v${d.version} · собрано ${d.date} ${d.time} · IDF ${d.idfVersion}`} />
}

function ResultPanel({ outcome, onChange }: { outcome: ReadOutcome; onChange: (o: ReadOutcome) => void }) {
  const { record, name, family, data, eeprom, baseAddress, notes, sha256, saveError } = outcome
  return (
    <Panel title="Результат">
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="fw-name">Название</Label>
          <Input
            id="fw-name"
            value={name}
            onChange={(e) => onChange({ ...outcome, name: e.target.value })}
            onBlur={() => record && name.trim() && void updateFirmware(record.id, { name: name.trim() })}
          />
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Размер:</span> {formatSize(data.length)} ·{' '}
          <span className="text-muted-foreground">с адреса</span> {hexAddr(baseAddress)}
          <div className="mt-1 break-all">
            <span className="text-muted-foreground">SHA-256:</span> {sha256}
          </div>
        </div>
        {notes.map((n) => (
          <div key={n} className="flex gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            {n}
          </div>
        ))}
        {record ? (
          <div className="text-sm text-muted-foreground">Сохранено в папку «Прошивки».</div>
        ) : (
          saveError && <ErrorCallout error={saveError} tone="warn" />
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void saveFile(`${name}.bin`, data)}>
            <Save className="size-4" /> Сохранить .bin
          </Button>
          {family === 'avr' && (
            <Button variant="outline" onClick={() => void saveFile(`${name}.hex`, formatIntelHex(data, baseAddress))}>
              Сохранить .hex
            </Button>
          )}
          {eeprom && (
            <Button variant="outline" onClick={() => void saveFile(`${name}_eeprom.bin`, eeprom)}>
              Сохранить EEPROM
            </Button>
          )}
          {record && (
            <Button variant="outline" onClick={() => void showFirmwareInFolder(record.id)}>
              <FolderOpen className="size-4" /> Показать в папке
            </Button>
          )}
          {record && (
            <Button variant="outline" asChild>
              <a href={`#/analysis/${record.id}`}>
                <FileSearch className="size-4" /> Открыть анализ
              </a>
            </Button>
          )}
          {record && (
            <Button variant="ghost" asChild>
              <a href={`#/flash/${record.id}`}>
                <Upload className="size-4" /> Залить на другую плату
              </a>
            </Button>
          )}
        </div>
      </div>
    </Panel>
  )
}

export function DevicePage() {
  const { status, op, supported, hasPort, choosePort, reconnect, disconnect, run } = useConnection()
  const driver = status.kind === 'connected' ? status.driver : null
  const info = driver?.info ?? null
  const currentDriver = useRef<BoardDriver | null>(null)
  currentDriver.current = driver
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [partitions, setPartitions] = useState<Partition[]>([])
  const [mode, setMode] = useState<Mode>('full')
  const [partitionLabel, setPartitionLabel] = useState('')
  const [fullUsage, setFullUsage] = useState<Usage | null>(null)
  const [outcome, setOutcome] = useState<ReadOutcome | null>(null)
  const [error, setError] = useState<ExplainedError | null>(null)

  // Новая плата: сбросить прошлые результаты; у ESP32 — прочитать разделы и паспорт приложения.
  useEffect(() => {
    setAppInfo(null)
    setPartitions([])
    setFullUsage(null)
    setOutcome(null)
    setError(null)
    setMode('full')
    if (!driver || driver.info.family !== 'esp32') return
    void run(
      'Читаю таблицу разделов',
      async (d) => ({ parts: (await d.readPartitionTable?.()) ?? [], app: (await d.appInfo?.()) ?? null }),
      { cancellable: false },
    ).then((r) => {
      // Пустая или зашифрованная flash — не ошибка: просто нет паспорта и разделов.
      // Повторный вызов эффекта в StrictMode получит «уже идёт операция» — его результат не нужен.
      if (currentDriver.current !== driver || !r.ok) return
      setPartitions(r.value.parts)
      setAppInfo(r.value.app)
      setPartitionLabel(r.value.parts[0]?.label ?? '')
    })
  }, [driver, run])

  async function onRead() {
    if (!info) return
    setError(null)
    setOutcome(null)
    const target: ReadTarget = mode === 'partition' ? { kind: 'partition', label: partitionLabel } : { kind: mode }
    const r = await run('Чтение прошивки', (d, p, s) => d.read(target, p, s))
    if (!r.ok) {
      if (!r.error.silent) setError(r.error)
      return
    }
    const read = r.value
    if (target.kind === 'full') setFullUsage(usage(read.data, info.family === 'avr' ? 128 : 4096))
    const desc = target.kind === 'partition' ? null : ((target.kind === 'app' ? parseAppDesc(read.data, 0) : null) ?? appInfo?.desc ?? null)
    const name = defaultName(info.chip, target.kind === 'partition' ? target.label : desc?.projectName, new Date())
    const sha256 = await sha256Hex(read.data)
    let record: FirmwareRecord | null = null
    let saveError: ExplainedError | undefined
    try {
      record = await saveFirmware({
        name,
        family: info.family,
        chip: info.chip,
        kind: target.kind,
        partitionLabel: read.partitionLabel,
        baseAddress: read.baseAddress,
        data: read.data,
        eeprom: read.eeprom,
        source: 'board',
        appName: desc?.projectName,
        appVersion: desc?.version,
      })
    } catch (e) {
      saveError = explainError(e)
    }
    setOutcome({ record, name, family: info.family, data: read.data, eeprom: read.eeprom, baseAddress: read.baseAddress, notes: read.notes, sha256, saveError })
  }

  const view = statusView(status)
  const busy = op !== null || status.kind === 'detecting'

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-medium">Устройство</h1>
      <Panel title="Подключение">
        <div className="flex flex-wrap items-start gap-3">
          <StatusDot tone={view.tone} pulse={status.kind === 'detecting'} className="mt-1.5" />
          <div className="min-w-0 flex-1">
            <div className="font-medium break-words">{view.title}</div>
            {view.subtitle && <div className="mt-0.5 text-sm break-words text-muted-foreground">{view.subtitle}</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            {status.kind === 'connected' ? (
              <>
                <Button variant="outline" onClick={() => void disconnect()} disabled={busy}>
                  <Unplug className="size-4" /> Отключить
                </Button>
                <Button variant="ghost" onClick={() => void choosePort()} disabled={busy}>
                  Сменить порт
                </Button>
              </>
            ) : (
              <>
                {status.kind === 'error' && hasPort && (
                  <Button variant="outline" onClick={() => void reconnect()} disabled={busy}>
                    <RefreshCw className="size-4" /> Повторить
                  </Button>
                )}
                <Button onClick={() => void choosePort()} disabled={busy || !supported}>
                  <Plug className="size-4" /> Выбрать COM-порт
                </Button>
              </>
            )}
          </div>
        </div>
        {status.kind === 'error' && status.error.hint && (
          <ErrorCallout error={{ title: 'Что сделать', hint: status.error.hint }} tone="warn" className="mt-4" />
        )}
        {!supported && (
          <ErrorCallout
            error={{ title: 'Этот браузер не умеет работать с COM-портами', hint: 'Откройте сайт в Chrome, Edge или Яндекс Браузере на компьютере.' }}
            tone="warn"
            className="mt-4"
          />
        )}
      </Panel>

      {info && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard title="Занято" value={fullUsage ? formatSize(fullUsage.used) : '—'} sub={fullUsage ? `${fullUsage.percent}% flash` : 'Считайте всю flash, чтобы узнать'}>
              {fullUsage && <UsageBar percent={fullUsage.percent} />}
            </StatCard>
            <AppCard info={info} appInfo={appInfo} />
            <StatCard title="Свободно" value={fullUsage ? formatSize(fullUsage.free) : '—'} sub={`из ${formatSize(info.flashSize)}`} />
          </div>

          <Panel title="Считать">
            {info.family === 'esp32' ? (
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="gap-3">
                <ModeOption value="full" title="Вся flash" hint={`Точный клон: загрузчик, приложение, настройки Wi-Fi и файлы · ${formatSize(info.flashSize)}`} />
                <ModeOption
                  value="app"
                  title="Только приложение"
                  hint={appInfo ? `Раздел ${appInfo.partition.label} · быстрее, файл меньше` : 'Недоступно: на плате не найден раздел приложения'}
                  disabled={!appInfo}
                />
                <ModeOption value="partition" title="Один раздел" hint="NVS, SPIFFS, LittleFS и т. п." disabled={!partitions.length}>
                  {mode === 'partition' && (
                    <Select value={partitionLabel} onValueChange={setPartitionLabel}>
                      <SelectTrigger className="mt-2 w-full sm:w-80">
                        <SelectValue placeholder="Раздел" />
                      </SelectTrigger>
                      <SelectContent>
                        {partitions.map((p) => (
                          <SelectItem key={p.label} value={p.label}>
                            {p.label} · {p.subtypeName} · {formatSize(p.size)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </ModeOption>
              </RadioGroup>
            ) : (
              <p className="text-sm text-muted-foreground">У Arduino считывается вся flash — 32 КБ вместе с загрузчиком.</p>
            )}
            <div className="mt-4">
              <Button onClick={() => void onRead()} disabled={busy}>
                <Download className="size-4" /> Считать
              </Button>
            </div>
            <OperationProgress className="mt-4" />
            {error && <ErrorCallout error={error} className="mt-4" />}
          </Panel>
        </>
      )}

      {outcome && <ResultPanel outcome={outcome} onChange={setOutcome} />}
    </div>
  )
}
