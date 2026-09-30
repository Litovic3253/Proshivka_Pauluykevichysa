/** Имя по умолчанию: «ESP32-S3_blink_2026-09-30_15-07». Символы, запрещённые в именах файлов Windows, — в «_». */
export function defaultName(chip: string, label: string | undefined, date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}`
  return [chip, label || 'firmware', stamp].join('_').replace(/[\\/:*?"<>|\s]+/g, '_')
}
