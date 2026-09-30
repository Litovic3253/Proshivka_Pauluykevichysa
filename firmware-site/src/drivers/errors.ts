import { hexAddr } from '@/analysis/bytes'

export class BoardNotFoundError extends Error {
  constructor(readonly attempts: string[]) {
    super('Плата не отвечает')
    this.name = 'BoardNotFoundError'
  }
}

export class UnsupportedChipError extends Error {
  constructor(detail: string) {
    super(`Чип не поддерживается: ${detail}`)
    this.name = 'UnsupportedChipError'
  }
}

export class VerifyError extends Error {
  constructor(readonly address: number) {
    super(`Проверка после записи не прошла: данные по адресу ${hexAddr(address)} отличаются`)
    this.name = 'VerifyError'
  }
}

export class DeviceLostError extends Error {
  constructor() {
    super('Кабель отключён')
    this.name = 'DeviceLostError'
  }
}
