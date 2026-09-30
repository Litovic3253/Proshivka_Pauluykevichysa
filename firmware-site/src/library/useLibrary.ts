import { useEffect, useState } from 'react'
import { listFirmware, subscribeLibrary, type FirmwareRecord } from './library'

/** Список прошивок, который обновляется после каждого сохранения, переименования и удаления. */
export function useLibrary(): FirmwareRecord[] {
  const [records, setRecords] = useState<FirmwareRecord[]>([])
  useEffect(() => {
    let active = true
    const load = () => void listFirmware().then((r) => active && setRecords(r))
    load()
    const off = subscribeLibrary(load)
    return () => {
      active = false
      off()
    }
  }, [])
  return records
}
