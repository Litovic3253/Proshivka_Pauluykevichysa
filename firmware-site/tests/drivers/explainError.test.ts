import { describe, expect, it } from 'vitest'
import { explainError } from '@/drivers/explainError'
import { BoardNotFoundError, DeviceLostError, UnsupportedChipError, VerifyError } from '@/drivers/errors'
import { SerialTimeoutError } from '@/serial/transport'

describe('explainError', () => {
  it('отмена выбора порта — молча', () => {
    expect(explainError(new DOMException('No port selected by the user.', 'NotFoundError')).silent).toBe(true)
  })

  it('порт занят', () => {
    const e = explainError(new DOMException('Failed to open serial port.', 'NetworkError'))
    expect(e.title).toBe('Порт занят другой программой')
    expect(e.hint).toMatch(/Arduino IDE/)
  })

  it('кабель отключён', () => {
    expect(explainError(new DeviceLostError()).title).toBe('Кабель отключён')
    expect(explainError(new DOMException('The device has been lost.', 'NetworkError')).title).toBe('Кабель отключён')
    expect(explainError(new DeviceLostError()).hint).toMatch(/загрузчик не пострадал/)
  })

  it('плата не отвечает — совет про BOOT/EN и DTR', () => {
    const e = explainError(new BoardNotFoundError(['a', 'b']))
    expect(e.title).toBe('Плата не отвечает')
    expect(e.hint).toMatch(/BOOT/)
    expect(e.hint).toMatch(/DTR/)
    expect(e.raw).toMatch(/a/)
  })

  it('чип, проверка, таймаут, отмена, место', () => {
    expect(explainError(new UnsupportedChipError('x')).title).toBe('Чип не поддерживается')
    expect(explainError(new VerifyError(0x100)).title).toBe('Проверка после записи не прошла')
    expect(explainError(new Error('MD5 of file does not match data in flash!')).title).toBe('Проверка после записи не прошла')
    expect(explainError(new SerialTimeoutError(1, 0)).title).toBe('Плата перестала отвечать')
    expect(explainError(new DOMException('aborted', 'AbortError')).title).toBe('Операция остановлена')
    expect(explainError(new DOMException('full', 'QuotaExceededError')).title).toBe('Не хватило места в браузере')
  })

  it('ошибка из главного процесса показывается без служебной приставки', () => {
    const e = explainError(new Error("Error invoking remote method 'library:remove': Error: Корзина недоступна для этого файла"))
    expect(e.title).toBe('Корзина недоступна для этого файла')
    expect(e.raw).toMatch(/library:remove/)
  })

  it('русское сообщение показывается как есть, прочее — общим текстом', () => {
    expect(explainError(new Error('Раздел «x» не найден')).title).toBe('Раздел «x» не найден')
    const e = explainError(new Error('weird'))
    expect(e.title).toBe('Что-то пошло не так')
    expect(e.raw).toBe('Error: weird')
  })
})
