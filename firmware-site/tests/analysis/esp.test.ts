import { describe, expect, it } from 'vitest'
import { bootloaderOffset, looksEncrypted, parseEspImage } from '@/analysis/espImage'
import { parseAppDesc } from '@/analysis/appDesc'
import { parsePartitionTable, PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE } from '@/analysis/partitions'
import { activeOtaSeq, crc32, selectAppPartition } from '@/analysis/otadata'
import { loadFixture } from '../helpers/fixtures'
import { buildEspFlash } from '../helpers/espFlash'

const app = loadFixture('esp32-app.bin')
const parts = parsePartitionTable(loadFixture('esp32-partitions.bin'))
const otaSlot1 = loadFixture('esp32-otadata-slot1.bin')

describe('parseEspImage', () => {
  it('разбирает образ приложения и считает его точную длину', () => {
    const img = parseEspImage(app)!
    expect(img.chipName).toBe('ESP32')
    expect(img.segments.length).toBeGreaterThan(2)
    expect(img.length).toBe(app.length)
  })

  it('разбирает загрузчик внутри полной flash', () => {
    expect(parseEspImage(buildEspFlash(), 0x1000)?.chipName).toBe('ESP32')
  })

  it('возвращает null для не-образа и обрезанного образа', () => {
    expect(parseEspImage(new Uint8Array(64).fill(0xff))).toBeNull()
    expect(parseEspImage(app.subarray(0, 100))).toBeNull()
  })
})

describe('looksEncrypted', () => {
  it('различает обычную, зашифрованную и пустую flash', () => {
    expect(bootloaderOffset('ESP32')).toBe(0x1000)
    expect(bootloaderOffset('ESP32-S3')).toBe(0)
    expect(looksEncrypted(buildEspFlash(), 0, 'ESP32')).toBe(false)
    expect(looksEncrypted(buildEspFlash({ encrypted: true }), 0, 'ESP32')).toBe(true)
    expect(looksEncrypted(new Uint8Array(0x2000).fill(0xff), 0, 'ESP32')).toBe(false)
    expect(looksEncrypted(app, 0x10000, 'ESP32')).toBeNull() // дамп не содержит загрузчик
  })
})

describe('parseAppDesc', () => {
  it('читает паспорт приложения', () => {
    const desc = parseAppDesc(app)!
    expect(desc.version).toBe('1.2.3')
    expect(desc.projectName).toBe('pauluk_fixture')
    expect(desc.idfVersion).toMatch(/^v?\d/)
    expect(desc.date).toMatch(/\d{4}/)
  })

  it('null, если паспорта нет', () => {
    expect(parseAppDesc(new Uint8Array(512))).toBeNull()
  })
})

describe('parsePartitionTable', () => {
  it('читает разделы из таблицы, собранной ESP-IDF', () => {
    expect(parts.map((p) => p.label)).toEqual(['nvs', 'otadata', 'phy_init', 'ota_0', 'ota_1', 'spiffs'])
    const ota1 = parts[4]
    expect(ota1).toMatchObject({ typeName: 'app', subtypeName: 'ota_1', offset: 0x190000, size: 0x180000, encrypted: false })
    expect(parts[5].subtypeName).toBe('spiffs')
    expect(PARTITION_TABLE_OFFSET).toBe(0x8000)
    expect(PARTITION_TABLE_SIZE).toBe(0xc00)
  })

  it('пустая flash — пустой список', () => {
    expect(parsePartitionTable(new Uint8Array(0xc00).fill(0xff))).toEqual([])
  })
})

describe('otadata', () => {
  it('crc32 совпадает со стандартным', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('находит активную запись с максимальным seq и верным CRC', () => {
    expect(activeOtaSeq(otaSlot1)).toBe(2)
    expect(activeOtaSeq(new Uint8Array(0x2000).fill(0xff))).toBeNull()
    const broken = otaSlot1.slice()
    broken[0x1000 + 28] ^= 0xff // порченый CRC второй записи
    expect(activeOtaSeq(broken)).toBe(1)
  })

  it('выбирает раздел приложения, который загрузится', () => {
    expect(selectAppPartition(parts, otaSlot1)?.label).toBe('ota_1')
    expect(selectAppPartition(parts, new Uint8Array(0x2000).fill(0xff))?.label).toBe('ota_0')
    expect(selectAppPartition(parts, null)?.label).toBe('ota_0')
    const factory = [{ ...parts[3], label: 'factory', subtype: 0, subtypeName: 'factory' }]
    expect(selectAppPartition(factory, null)?.label).toBe('factory')
    expect(selectAppPartition([], null)).toBeNull()
  })
})
