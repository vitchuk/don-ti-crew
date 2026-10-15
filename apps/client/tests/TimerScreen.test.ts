import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { beepMock } = vi.hoisted(() => ({ beepMock: vi.fn() }))

vi.mock('../src/audio/audioCues', () => ({
  getAudioContext: () => null,
  beep: beepMock,
}))

import TimerScreen from '../src/components/TimerScreen.vue'
import { useTimerSession } from '../src/composables/useTimerSession'
import type { WorkoutTemplate } from '../src/db/db'

const TEMPLATE: WorkoutTemplate = {
  name: 'Табата 20/10 × 8 раундов',
  protocol: {
    prepareSec: 10,
    workSec: 20,
    restSec: 10,
    rounds: 8,
    cycles: 1,
    restBetweenCyclesSec: 60,
  },
  isPreset: true,
}

const FAKE_TIMERS: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: [
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'Date',
    'performance',
  ],
}

describe('TimerScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers(FAKE_TIMERS)
    beepMock.mockClear()
  })

  afterEach(() => {
    useTimerSession().abort()
    vi.useRealTimers()
  })

  it('отображает фазу, отсчёт, раунд и прогресс (FR-8, NFR-3)', async () => {
    const session = useTimerSession()
    session.start(TEMPLATE)
    const wrapper = mount(TimerScreen)
    await flushPromises()
    expect(wrapper.find('.timer-cue').text()).toBe('Подготовка')
    expect(wrapper.get('.timer-value').text()).toBe('00:10')
    expect(wrapper.text()).toContain('Раунд 1 из 8')
    expect(wrapper.findAll('.timer-progress li')).toHaveLength(8)
    await wrapper.unmount()
  })

  it('контроль пауза/продолжение/сброс/стоп обновляет UI (FR-4)', async () => {
    const session = useTimerSession()
    session.start(TEMPLATE)
    const wrapper = mount(TimerScreen)
    await flushPromises()
    vi.advanceTimersByTime(12_000)
    await flushPromises()
    expect(wrapper.get('.timer-cue').text()).toBe('Работа')
    const pauseBtn = wrapper.findAll('button').find((b) => b.text() === 'Пауза')!
    await pauseBtn.trigger('click')
    expect(
      wrapper.findAll('button').some((b) => b.text() === 'Продолжить'),
    ).toBe(true)
    const pausedTime = wrapper.get('.timer-value').text()
    vi.advanceTimersByTime(5_000)
    expect(wrapper.get('.timer-value').text()).toBe(pausedTime)
    await wrapper.findAll('button').find((b) => b.text() === 'Продолжить')!.trigger('click')
    expect(
      wrapper.findAll('button').some((b) => b.text() === 'Пауза'),
    ).toBe(true)
    vi.advanceTimersByTime(1_000)
    await flushPromises()
    expect(wrapper.get('.timer-value').text()).not.toBe(pausedTime)
    const resetBtn = wrapper.findAll('button').find((b) => b.text() === 'Сброс')!
    await resetBtn.trigger('click')
    expect(wrapper.get('.timer-cue').text()).toBe('Подготовка')
    expect(wrapper.get('.timer-value').text()).toBe('00:10')
    await wrapper.findAll('button').find((b) => b.text() === 'Стоп')!.trigger('click')
    expect(wrapper.text()).toContain('Сохранить прерванную сессию?')
    await wrapper.findAll('button').find((b) => b.text() === 'Продолжить')!.trigger('click')
    expect(wrapper.text()).not.toContain('Сохранить прерванную сессию?')
    await wrapper.unmount()
  })

  it('после завершения — фаза Завершение, результат, кнопка Готово', async () => {
    const session = useTimerSession()
    session.start(TEMPLATE)
    const wrapper = mount(TimerScreen)
    await flushPromises()
    vi.advanceTimersByTime(250_250)
    await flushPromises()
    expect(wrapper.get('.timer-cue').text()).toBe('Завершение')
    expect(wrapper.text()).toContain('Завершено раундов: 8')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Готово')).toBe(true)
    await wrapper.unmount()
  })
})
