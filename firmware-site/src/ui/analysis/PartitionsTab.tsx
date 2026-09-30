import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatSize, hexAddr } from '@/analysis/bytes'
import type { Partition } from '@/analysis/partitions'
import { Panel } from '../components/Panel'

const COLORS = ['var(--data)', 'var(--ok)', 'var(--warn)', '#8B5CF6', 'var(--err)', 'var(--idle)']
const color = (i: number) => COLORS[i % COLORS.length]

export function PartitionsTab({ partitions, flashSize }: { partitions: Partition[]; flashSize: number }) {
  return (
    <Panel title="Разделы flash">
      <div className="relative h-6 w-full overflow-hidden rounded-[8px] border bg-muted" role="img" aria-label="Карта flash">
        {partitions.map((p, i) => (
          <div
            key={p.label}
            className="absolute top-0 h-full border-r border-background/60"
            title={`${p.label} · ${hexAddr(p.offset)} · ${formatSize(p.size)}`}
            style={{ left: `${(p.offset / flashSize) * 100}%`, width: `${Math.max((p.size / flashSize) * 100, 0.4)}%`, background: color(i) }}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {partitions.map((p, i) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: color(i) }} />
            {p.label}
          </span>
        ))}
      </div>
      <Table className="mt-4">
        <TableHeader>
          <TableRow>
            <TableHead>Раздел</TableHead>
            <TableHead>Тип</TableHead>
            <TableHead>Адрес</TableHead>
            <TableHead>Размер</TableHead>
            <TableHead className="hidden sm:table-cell">Шифрование</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {partitions.map((p) => (
            <TableRow key={p.label}>
              <TableCell className="font-medium">{p.label}</TableCell>
              <TableCell>{p.typeName} / {p.subtypeName}</TableCell>
              <TableCell>{hexAddr(p.offset)}</TableCell>
              <TableCell>{formatSize(p.size)}</TableCell>
              <TableCell className="hidden sm:table-cell">{p.encrypted ? 'да' : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  )
}
