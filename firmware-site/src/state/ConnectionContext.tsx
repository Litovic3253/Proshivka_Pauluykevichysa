import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { detectBoard } from '@/drivers/detect'
import { DeviceLostError } from '@/drivers/errors'
import { explainError, type ExplainedError } from '@/drivers/explainError'
import type { BoardDriver, Progress } from '@/drivers/types'
import { describeElectronPort, describePort } from '@/serial/portName'
import { DisconnectGuard } from './disconnectGuard'
import { OperationRunner, type OpState, type RunResult } from './operationRunner'
import { takeLastChosen } from './portPicker'

export type ConnStatus =
  | { kind: 'idle' }
  | { kind: 'detecting'; portLabel: string }
  | { kind: 'connected'; portLabel: string; driver: BoardDriver }
  | { kind: 'error'; portLabel?: string; error: ExplainedError }

type DriverOp<T> = (driver: BoardDriver, onProgress: Progress, signal: AbortSignal) => Promise<T>

export interface ConnectionValue {
  /** Браузер умеет Web Serial (Chrome, Edge, Яндекс на компьютере, https или localhost). */
  supported: boolean
  status: ConnStatus
  op: OpState | null
  log: string[]
  hasPort: boolean
  choosePort(): Promise<void>
  reconnect(): Promise<void>
  disconnect(): Promise<void>
  run<T>(label: string, fn: DriverOp<T>, opts?: { cancellable?: boolean }): Promise<RunResult<T>>
  cancel(): void
  clearLog(): void
}

const ConnectionContext = createContext<ConnectionValue | null>(null)

const UNSUPPORTED: ExplainedError = {
  title: 'Этот браузер не умеет работать с COM-портами',
  hint: 'Откройте сайт в Chrome, Edge или Яндекс Браузере на компьютере.',
  raw: 'navigator.serial недоступен',
}

function timestamp(): string {
  return new Date().toLocaleTimeString('ru-RU')
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const supported = typeof navigator !== 'undefined' && 'serial' in navigator && window.isSecureContext
  const [status, setStatus] = useState<ConnStatus>({ kind: 'idle' })
  const [log, setLog] = useState<string[]>([])
  const [hasPort, setHasPort] = useState(false)
  const runner = useMemo(() => new OperationRunner(), [])
  const guard = useMemo(() => new DisconnectGuard(), [])
  const op = useSyncExternalStore(runner.subscribe, runner.getState)
  const portRef = useRef<SerialPort | null>(null)
  const driverRef = useRef<BoardDriver | null>(null)
  const portLabelRef = useRef('')

  const addLog = useCallback((line: string) => {
    setLog((l) => [...l.slice(-499), `${timestamp()}  ${line}`])
  }, [])

  const connect = useCallback(
    async (port: SerialPort, portLabel: string) => {
      setStatus({ kind: 'detecting', portLabel })
      addLog(`Порт: ${portLabel}`)
      try {
        const driver = await detectBoard(port, addLog)
        driverRef.current = driver
        addLog(`Подключено: ${driver.info.chip}, ${driver.info.baud} бод`)
        setStatus({ kind: 'connected', portLabel, driver })
      } catch (e) {
        const error = explainError(e)
        addLog(`Ошибка: ${error.raw}`)
        setStatus({ kind: 'error', portLabel, error })
      }
    },
    [addLog],
  )

  const disconnect = useCallback(async () => {
    runner.cancel()
    const driver = driverRef.current
    driverRef.current = null
    guard.expect() // сброс платы с родным USB вызовет disconnect — это не выдернутый кабель
    await driver?.disconnect().catch(() => {})
    setStatus({ kind: 'idle' })
  }, [runner, guard])

  const choosePort = useCallback(async () => {
    if (!supported) {
      setStatus({ kind: 'error', error: UNSUPPORTED })
      return
    }
    let port: SerialPort
    try {
      port = await navigator.serial.requestPort()
    } catch (e) {
      const error = explainError(e)
      if (!error.silent) setStatus({ kind: 'error', error })
      return
    }
    const chosen = takeLastChosen()
    const portLabel = chosen ? describeElectronPort(chosen) : describePort(port.getInfo())
    await disconnect()
    portRef.current = port
    portLabelRef.current = portLabel
    setHasPort(true)
    await connect(port, portLabel)
  }, [supported, connect, disconnect])

  const reconnect = useCallback(async () => {
    const port = portRef.current
    if (!port) return
    await disconnect()
    await connect(port, portLabelRef.current || describePort(port.getInfo()))
  }, [connect, disconnect])

  // Кабель выдернули: операция прерывается, статус — «Кабель отключён».
  useEffect(() => {
    if (!supported) return
    const onDisconnect = (e: Event) => {
      if (e.target !== portRef.current) return
      if (!guard.isCableLoss()) {
        portRef.current = null
        setHasPort(false)
        addLog('Плата перезагрузилась и переподключилась по USB')
        return
      }
      runner.cancel(new DeviceLostError())
      driverRef.current = null
      portRef.current = null
      setHasPort(false)
      addLog('Кабель отключён')
      setStatus({ kind: 'error', error: explainError(new DeviceLostError()) })
    }
    navigator.serial.addEventListener('disconnect', onDisconnect)
    return () => navigator.serial.removeEventListener('disconnect', onDisconnect)
  }, [supported, runner, guard, addLog])

  // Во время операции браузер переспросит перед закрытием вкладки.
  useEffect(() => {
    if (!op) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [op])

  const run = useCallback(
    async <T,>(label: string, fn: DriverOp<T>, opts?: { cancellable?: boolean }): Promise<RunResult<T>> => {
      const driver = driverRef.current
      if (!driver) {
        return { ok: false, error: { title: 'Плата не подключена', hint: 'Выберите COM-порт на экране «Устройство».', raw: '' } }
      }
      addLog(`${label}…`)
      const result = await runner.run(label, (p, s) => fn(driver, p, s), opts)
      addLog(result.ok ? `${label}: готово` : `${label}: ${result.error.raw || result.error.title}`)
      return result
    },
    [runner, addLog],
  )

  const value: ConnectionValue = {
    supported,
    status,
    op,
    log,
    hasPort,
    choosePort,
    reconnect,
    disconnect,
    run,
    cancel: () => runner.cancel(),
    clearLog: () => setLog([]),
  }
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

export function useConnection(): ConnectionValue {
  const value = useContext(ConnectionContext)
  if (!value) throw new Error('useConnection вне ConnectionProvider')
  return value
}
