import { Panel } from '../components/Panel'

export function AnalysisPage({ id }: { id: number | null }) {
  return <Panel title="Анализ">Прошивка {id ?? '—'}</Panel>
}
