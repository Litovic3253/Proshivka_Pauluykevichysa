import { BoardNotFoundError, DeviceLostError, UnsupportedChipError, VerifyError } from './errors'

export interface ExplainedError {
  title: string
  hint?: string
  raw: string
  /** Не показывать пользователю (например, он сам закрыл окно выбора порта). */
  silent?: boolean
}

const LOST_HINT =
  'Подключите плату и повторите. Если прерывалась запись — залейте прошивку ещё раз: загрузчик не пострадал.'

export function explainError(e: unknown): ExplainedError {
  const name = (e as { name?: string } | null)?.name ?? ''
  const fullMessage = e instanceof Error ? e.message : String(e)
  // Ошибки из главного процесса Electron приходят с приставкой «Error invoking remote method …».
  const message = fullMessage.replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/, '')
  const raw =
    e instanceof BoardNotFoundError
      ? [message, ...e.attempts].join('\n')
      : e instanceof Error
        ? `${name}: ${fullMessage}`
        : String(e)

  if (name === 'NotFoundError') return { title: 'Порт не выбран', raw, silent: true }
  if (name === 'InvalidStateError' || (name === 'NetworkError' && /open/i.test(message))) {
    return {
      title: 'Порт занят другой программой',
      hint: 'Закройте Arduino IDE, монитор порта, PlatformIO или другую вкладку с этим сайтом и попробуйте снова.',
      raw,
    }
  }
  if (e instanceof DeviceLostError || name === 'NetworkError' || /device has been lost|disconnected/i.test(message)) {
    return { title: 'Кабель отключён', hint: LOST_HINT, raw }
  }
  if (e instanceof BoardNotFoundError) {
    return {
      title: 'Плата не отвечает',
      hint:
        'ESP32: зажмите BOOT, нажмите и отпустите EN (RST), отпустите BOOT и подключитесь снова. ' +
        'Arduino: проверьте, что выбран порт этой платы; для Pro Mini нужен USB-адаптер с выводом DTR.',
      raw,
    }
  }
  if (e instanceof UnsupportedChipError) {
    return {
      title: 'Чип не поддерживается',
      hint: 'Поддерживаются Arduino Uno / Nano / Pro Mini (ATmega328P) и ESP32, ESP32-S2, ESP32-S3, ESP32-C3.',
      raw,
    }
  }
  if (e instanceof VerifyError || /MD5 of file does not match/i.test(message)) {
    return {
      title: 'Проверка после записи не прошла',
      hint: 'Залейте прошивку ещё раз. Если ошибка повторяется — попробуйте другой кабель или плату.',
      raw,
    }
  }
  if (name === 'AbortError') return { title: 'Операция остановлена', raw }
  if (name === 'QuotaExceededError') {
    return {
      title: 'Не хватило места в браузере',
      hint: 'Файл всё равно можно скачать. Чтобы сохранить в Библиотеку, удалите старые прошивки.',
      raw,
    }
  }
  if (name === 'SerialTimeoutError' || /timeout|timed out/i.test(message)) {
    return {
      title: 'Плата перестала отвечать',
      hint: 'Проверьте кабель и повторите. Если не помогает — отключите и снова подключите плату.',
      raw,
    }
  }
  if (/[а-яё]/i.test(message)) return { title: message, raw }
  return { title: 'Что-то пошло не так', hint: 'Подробности — в журнале внизу страницы.', raw }
}
