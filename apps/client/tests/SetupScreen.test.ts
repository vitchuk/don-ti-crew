import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { beepMock } = vi.hoisted(() => ({ beepMock: vi.fn() }))

vi.mock('../src/audio/audioCues', () => ({
  getAudioContext: () => null,
  beep: beepMock,
}))

import SetupScreen from '../src/components/SetupScreen.vue'
import { db } from '../src/db/db'
import { templatesRepo } from '../src/db/repositories'
import { DEFAULT_PROTOCOL } from '../src/domain/protocol'

describe('SetupScreen', () => {
  beforeEach(async () => {
    vi.useRealTimers()
    await db.templates.clear()
    await db.sessions.clear()
  })

  afterEach(async () => {
    await db.templates.clear()
  })

  it('валидация блокирует сохранение невалидного протокола (AC-6)', async () => {
    const wrapper = mount(SetupScreen)
    await wrapper.find('#field-name').setValue('')
    await wrapper.find('#field-workSec').setValue(0)
    await wrapper.find('#field-rounds').setValue(31)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    const errorsText = wrapper.find('.setup-errors').text()
    expect(errorsText).toContain('Работа')
    expect(errorsText).toContain('Раунды')
    expect(wrapper.text()).toContain('Введите имя шаблона')
    expect(await db.templates.count()).toBe(0)
    await wrapper.unmount()
  })

  it('валидный протокол сохраняется как пользовательский шаблон', async () => {
    const wrapper = mount(SetupScreen)
    await wrapper.find('#field-name').setValue('Моя табата')
    await wrapper.find('#field-workSec').setValue(0)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(await db.templates.count()).toBe(0)
    await wrapper.find('#field-workSec').setValue(30)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(await db.templates.count()).toBe(1)
    const [saved] = await templatesRepo.list()
    expect(saved!.name).toBe('Моя табата')
    expect(saved!.isPreset).toBe(false)
    expect(saved!.protocol.workSec).toBe(30)
    expect(saved!.protocol).toEqual({ ...DEFAULT_PROTOCOL, workSec: 30 })
    await wrapper.unmount()
  })

  it('режим изменения: поля протокола недоступны, подпись о неизменяемости, сохраняется только имя (M1)', async () => {
    const created = await templatesRepo.create('Старое имя', { ...DEFAULT_PROTOCOL, workSec: 25 })
    const wrapper = mount(SetupScreen, { props: { template: created } })
    expect(wrapper.text()).toContain(
      'Протокол шаблона неизменяем. Создайте новый шаблон, если нужен другой протокол.',
    )
    const protocolKeys = [
      'prepareSec',
      'workSec',
      'restSec',
      'rounds',
      'cycles',
      'restBetweenCyclesSec',
    ] as const
    for (const key of protocolKeys) {
      expect(wrapper.find(`#field-${key}`).attributes('disabled')).toBeDefined()
    }
    await wrapper.find('#field-name').setValue('Новое имя')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    const [saved] = await templatesRepo.list()
    expect(saved!.name).toBe('Новое имя')
    expect(saved!.protocol.workSec).toBe(25)
    await vi.waitFor(() => expect(wrapper.emitted('close')).toHaveLength(1))
    await wrapper.unmount()
  })
})
