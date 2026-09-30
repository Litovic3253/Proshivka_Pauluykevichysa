import { useState } from 'react'
import { ConnectionProvider } from '@/state/ConnectionContext'
import { AppShell } from '@/ui/layout/AppShell'
import { UnsupportedBrowser } from '@/ui/layout/UnsupportedBrowser'

export default function App() {
  const supported = 'serial' in navigator && window.isSecureContext
  const [limited, setLimited] = useState(false)
  if (!supported && !limited) return <UnsupportedBrowser onContinue={() => setLimited(true)} />
  return (
    <ConnectionProvider>
      <AppShell />
    </ConnectionProvider>
  )
}
