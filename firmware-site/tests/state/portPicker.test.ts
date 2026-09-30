import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { choosePort, getPickerPorts, initPortPicker, subscribePicker, takeLastChosen } from '@/state/portPicker'
import { installFakeBridge } from '../helpers/fakeBridge'

let env: Awaited<ReturnType<typeof installFakeBridge>>
let stop: () => void
beforeEach(async () => { env = await installFakeBridge(); stop = initPortPicker() })
afterEach(async () => { stop(); await env.cleanup() })

const com5 = { portId: 'a', portName: 'COM5', vendorId: '6790', productId: '29987' }
const com7 = { portId: 'b', portName: 'COM7' }

describe('portPicker', () => {
  it('показывает список по запросу и обновляет его, пока окно открыто', () => {
    let calls = 0
    const off = subscribePicker(() => calls++)
    env.offerPorts([com5])
    expect(getPickerPorts()).toEqual([com5])
    env.offerPorts([com5, com7]) // плату подключили при открытом окне
    expect(getPickerPorts()).toHaveLength(2)
    off()
    expect(calls).toBe(2)
  })

  it('выбор отдаёт portId в программу и запоминается для подписи', () => {
    env.offerPorts([com5, com7])
    choosePort(com7)
    expect(env.chosen).toEqual(['b'])
    expect(getPickerPorts()).toBeNull()
    expect(takeLastChosen()).toEqual(com7)
    expect(takeLastChosen()).toBeNull()
  })

  it('закрыли окно — запрос отменяется', () => {
    env.offerPorts([com5])
    choosePort(null)
    expect(env.chosen).toEqual([null])
    expect(takeLastChosen()).toBeNull()
  })
})
