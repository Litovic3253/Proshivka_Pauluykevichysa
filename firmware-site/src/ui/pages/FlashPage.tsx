import { Panel } from '../components/Panel'

export function FlashPage({ id }: { id: number | null }) {
  return <Panel title="Заливка">Прошивка {id ?? '—'}</Panel>
}
