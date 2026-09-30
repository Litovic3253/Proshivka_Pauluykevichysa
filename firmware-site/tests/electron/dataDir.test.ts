import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { dataDir } from '../../electron/dataDir.mjs'

describe('dataDir', () => {
  it('переносной exe — папка, где лежит exe', () => {
    expect(dataDir({ env: { PORTABLE_EXECUTABLE_DIR: 'D:\\Прошивки' }, isPackaged: true, execPath: 'C:\\tmp\\x.exe', devRoot: 'C:\\dev' })).toBe('D:\\Прошивки')
  })
  it('собранная программа без portable — рядом с exe; разработка — корень проекта', () => {
    expect(dataDir({ env: {}, isPackaged: true, execPath: path.join('C:', 'app', 'x.exe'), devRoot: 'C:\\dev' })).toBe(path.join('C:', 'app'))
    expect(dataDir({ env: {}, isPackaged: false, execPath: 'electron.exe', devRoot: 'C:\\dev' })).toBe('C:\\dev')
  })
})
