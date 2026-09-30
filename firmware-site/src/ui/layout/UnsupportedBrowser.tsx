import { Button } from '@/components/ui/button'
import { Panel } from '../components/Panel'

export function UnsupportedBrowser({ onContinue }: { onContinue: () => void }) {
  const insecure = !window.isSecureContext
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Panel className="max-w-lg">
        <img src="/icon.png" alt="" className="mb-4 size-12 rounded-[12px]" />
        <h1 className="text-xl font-medium">Прошивки Паулюкевичуса</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {insecure
            ? 'Сайт открыт по незащищённому адресу. Работать с COM-портами браузер разрешает только по https:// или на localhost.'
            : 'Этот браузер не умеет работать с COM-портами (Web Serial). Откройте сайт в Chrome, Edge или Яндекс Браузере на компьютере — на телефоне, в Firefox и Safari подключить плату нельзя.'}
        </p>
        <Button className="mt-5" variant="outline" onClick={onContinue}>
          Открыть Библиотеку и Анализ без платы
        </Button>
      </Panel>
    </main>
  )
}
