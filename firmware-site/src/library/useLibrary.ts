import { useEffect, useState } from 'react'
import { explainError, type ExplainedError } from '@/drivers/explainError'
import { listFirmware, subscribeLibrary, type FirmwareRecord } from './library'

export interface LibraryState {
  records: FirmwareRecord[]
  /** Список не удалось прочитать (папка недоступна, library.json занят). */
  error: ExplainedError | null
}

/** Список прошивок, который обновляется после каждого сохранения, переименования и удаления. */
export function useLibraryState(): LibraryState {
  const [state, setState] = useState<LibraryState>({ records: [], error: null })
  useEffect(() => {
    let active = true
    const load = () =>
      void listFirmware().then(
        (records) => active && setState({ records, error: null }),
        (e) => active && setState((s) => ({ ...s, error: explainError(e) })),
      )
    load()
    const off = subscribeLibrary(load)
    return () => {
      active = false
      off()
    }
  }, [])
  return state
}

export function useLibrary(): FirmwareRecord[] {
  return useLibraryState().records
}
