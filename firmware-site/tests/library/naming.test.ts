import { describe, expect, it } from 'vitest'
import { defaultName } from '@/library/naming'

describe('defaultName', () => {
  it('чип, имя проекта и время, без запрещённых в Windows символов', () => {
    const d = new Date(2026, 8, 30, 15, 7)
    expect(defaultName('ESP32-S3', 'blink', d)).toBe('ESP32-S3_blink_2026-09-30_15-07')
    expect(defaultName('ATmega328P', undefined, d)).toBe('ATmega328P_firmware_2026-09-30_15-07')
    expect(defaultName('ESP32', 'my app:v2', d)).toBe('ESP32_my_app_v2_2026-09-30_15-07')
  })
})
