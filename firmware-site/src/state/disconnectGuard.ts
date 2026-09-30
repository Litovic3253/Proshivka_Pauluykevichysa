/**
 * После «Отключить» или заливки плата перезагружается. У ESP32-S2/S3/C3 с родным USB это
 * переподключает USB-устройство, и браузер присылает disconnect — это не выдернутый кабель.
 */
export class DisconnectGuard {
  private quietUntil = 0

  constructor(
    private readonly now: () => number = Date.now,
    private readonly windowMs = 5000,
  ) {}

  /** Сейчас будет намеренное отключение. */
  expect(): void {
    this.quietUntil = this.now() + this.windowMs
  }

  isCableLoss(): boolean {
    return this.now() > this.quietUntil
  }
}
