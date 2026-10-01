import { useEffect } from 'react'
import { bridge } from '@/bridge'
import { listFirmware } from '@/library/library'
import { ConnectionProvider } from '@/state/ConnectionContext'
import { AppShell } from '@/ui/layout/AppShell'

export default function App() {
  // Заставка закрывается, когда интерфейс нарисован и библиотека прочитана.
  useEffect(() => {
    void listFirmware().finally(() => bridge().app.ready())
  }, [])
  return (
    <ConnectionProvider>
      <AppShell />
    </ConnectionProvider>
  )
}
