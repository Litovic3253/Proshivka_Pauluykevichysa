import { useEffect, useMemo, useState } from 'react'

export type Route =
  | { page: 'device' }
  | { page: 'library' }
  | { page: 'analysis'; id: number | null }
  | { page: 'flash'; id: number | null }

/** Адреса вида #/analysis/12 — обновление страницы оставляет на том же экране. */
export function parseRoute(hash: string): Route {
  const [, page, rawId] = hash.replace(/^#/, '').split('/')
  const id = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null
  switch (page) {
    case 'library':
      return { page: 'library' }
    case 'analysis':
      return { page: 'analysis', id }
    case 'flash':
      return { page: 'flash', id }
    default:
      return { page: 'device' }
  }
}

export function useHashRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return useMemo(() => parseRoute(hash), [hash])
}
