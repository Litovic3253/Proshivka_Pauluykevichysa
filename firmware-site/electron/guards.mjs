/** Правила безопасности окна — без Electron, чтобы их можно было проверить тестами. */
import { pathToFileURL } from 'node:url'

/** Окно может показывать только собственный index.html (с любым #-адресом экрана). */
export function isOwnPage(url, indexFile) {
  try {
    const target = new URL(url)
    target.hash = ''
    return target.href === pathToFileURL(indexFile).href
  } catch {
    return false
  }
}

const ALLOWED_PERMISSIONS = new Set(['serial', 'clipboard-sanitized-write'])

/** Программе нужны только COM-порты и копирование текста (журнал, строки). */
export function allowPermission(permission) {
  return ALLOWED_PERMISSIONS.has(permission)
}
