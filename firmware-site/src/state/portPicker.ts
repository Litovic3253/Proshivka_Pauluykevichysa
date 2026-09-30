import { bridge, type PortChoice } from '@/bridge'

/**
 * Окно выбора порта: navigator.serial.requestPort() в программе приходит сюда списком
 * портов с именами (COM5), пользователь выбирает, выбор уходит обратно в Electron.
 */
let ports: PortChoice[] | null = null
let lastChosen: PortChoice | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export function initPortPicker(): () => void {
  return bridge().ports.onRequest((list) => {
    ports = list
    emit()
  })
}

export function getPickerPorts(): PortChoice[] | null {
  return ports
}

export function subscribePicker(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function choosePort(p: PortChoice | null): void {
  lastChosen = p
  ports = null
  emit()
  bridge().ports.choose(p?.portId ?? null)
}

/** Какой порт выбрали последним — для подписи «Подключено · COM5 · …». */
export function takeLastChosen(): PortChoice | null {
  const p = lastChosen
  lastChosen = null
  return p
}
