import path from 'node:path'

/** Где лежит папка «Прошивки»: рядом с exe, как данные Студии; при разработке — в корне проекта. */
export function dataDir({ env, isPackaged, execPath, devRoot }) {
  if (env.PORTABLE_EXECUTABLE_DIR) return env.PORTABLE_EXECUTABLE_DIR
  if (isPackaged) return path.dirname(execPath)
  return devRoot
}
