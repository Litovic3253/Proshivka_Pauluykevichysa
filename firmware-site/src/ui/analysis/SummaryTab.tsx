import type { FirmwareAnalysis } from '@/analysis/analyze'
import { formatSize, hexAddr } from '@/analysis/bytes'
import type { FirmwareRecord } from '@/library/library'
import { ErrorCallout } from '../components/ErrorCallout'
import { Panel } from '../components/Panel'
import { StatCard, UsageBar } from '../components/StatCard'
import { formatDate } from '../library/recordFiles'

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="break-all">{v}</dd>
    </>
  )
}

export function SummaryTab({ record, analysis }: { record: FirmwareRecord; analysis: FirmwareAnalysis }) {
  const { usage: u, appDesc, bootloader, encrypted, appOffset, image } = analysis
  return (
    <div className="space-y-4">
      {encrypted && (
        <ErrorCallout
          tone="warn"
          error={{
            title: 'Похоже, flash зашифрована',
            hint: 'Дамп годится как резервная копия этой же платы, но на другой плате работать не будет; паспорт и строки не читаются.',
          }}
        />
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="Занято" value={formatSize(u.used)} sub={`${u.percent}% из ${formatSize(u.total)}`}>
          <UsageBar percent={u.percent} />
        </StatCard>
        <StatCard
          title="Чип"
          value={record.chip}
          sub={bootloader?.flashSizeBytes ? `загрузчик настроен на ${formatSize(bootloader.flashSizeBytes)} flash` : record.source === 'board' ? 'считано с платы' : 'загружено из файла'}
        />
        <StatCard title="Сохранено" value={formatDate(record.createdAt)} sub={record.note || (record.hasEeprom ? 'вместе с EEPROM' : undefined)} />
      </div>
      <Panel title="Контрольная сумма">
        <div className="break-all text-sm">SHA-256: {record.sha256}</div>
        <p className="mt-1 text-xs text-muted-foreground">Если у двух файлов суммы совпадают — прошивки одинаковые байт в байт.</p>
      </Panel>
      {record.family === 'esp32' && (
        <Panel title="Паспорт приложения">
          {appDesc ? (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
              <Row k="Проект" v={appDesc.projectName} />
              <Row k="Версия" v={appDesc.version} />
              <Row k="Собрано" v={`${appDesc.date} ${appDesc.time}`} />
              <Row k="ESP-IDF" v={appDesc.idfVersion} />
              {appOffset !== null && <Row k="Адрес" v={hexAddr(appOffset)} />}
              {image && <Row k="Размер образа" v={formatSize(image.length)} />}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Паспорт приложения в этом дампе не найден.</p>
          )}
        </Panel>
      )}
      <Panel title="Почему здесь нет исходного кода">
        <p className="text-sm text-muted-foreground">
          При компиляции скетч превращается в машинные инструкции: имена переменных, комментарии и структура программы исчезают.
          Поэтому из платы нельзя получить .ino или .cpp — только бинарный код. Что можно узнать:{' '}
          {record.family === 'esp32' ? 'паспорт приложения, разделы, ' : ''}текстовые строки (сообщения Serial.print, имена Wi-Fi-сетей,
          адреса серверов) и сами байты во вкладке HEX.
        </p>
      </Panel>
    </div>
  )
}
