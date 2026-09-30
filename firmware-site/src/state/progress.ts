export function etaSeconds(done: number, total: number, startedAt: number, now: number): number | null {
  if (done <= 0 || total <= 0 || done >= total) return null
  const elapsed = (now - startedAt) / 1000
  if (elapsed < 1) return null
  return Math.round((elapsed / done) * (total - done))
}

export function formatEta(sec: number | null): string {
  if (sec === null) return ''
  if (sec < 60) return `ещё ~${Math.max(1, sec)} с`
  return `ещё ~${Math.round(sec / 60)} мин`
}

export function percent(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0
}
