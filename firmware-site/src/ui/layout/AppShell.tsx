import { useState } from 'react'
import { LogPanel } from '../components/LogPanel'
import { AnalysisPage } from '../pages/AnalysisPage'
import { DevicePage } from '../pages/DevicePage'
import { FlashPage } from '../pages/FlashPage'
import { LibraryPage } from '../pages/LibraryPage'
import { useHashRoute } from '../routing'
import { PortPickerDialog } from './PortPickerDialog'
import { Sidebar } from './Sidebar'
import { ThemeDialog } from './ThemeDialog'

export function AppShell() {
  const route = useHashRoute()
  const [themeOpen, setThemeOpen] = useState(false)
  return (
    <div className="flex min-h-screen">
      <Sidebar route={route} onTheme={() => setThemeOpen(true)} />
      <main className="min-w-0 flex-1 px-4 py-6 min-[900px]:px-8">
        <div className="mx-auto max-w-[1180px] space-y-4">
          {route.page === 'device' && <DevicePage />}
          {route.page === 'library' && <LibraryPage />}
          {route.page === 'analysis' && <AnalysisPage key={route.id ?? 'none'} id={route.id} />}
          {route.page === 'flash' && <FlashPage key={route.id ?? 'none'} id={route.id} />}
          <LogPanel />
        </div>
      </main>
      <ThemeDialog open={themeOpen} onOpenChange={setThemeOpen} />
      <PortPickerDialog />
    </div>
  )
}
