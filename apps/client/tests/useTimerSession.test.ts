import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { beepMock } = vi.hoisted(() => ({ beepMock: vi.fn() }))

vi.mock('../src/audio/audioCues', () => ({
  getAudioContext: () => null,
  beep: beepMock,
}))

import { db } from '../src/db/db'
import { sessionsRepo } from '../src/db/repositories'
import { useTimerSession } from '../src/composables/useTimerSession'
import { DEFAULT_PROTOCOL } from '../src/domain/protocol'
import type { WorkoutTemplate } from '../src/db/db'

function makeTemplate(init: Partial<WorkoutTemplate> = {}): WorkoutTemplate {
  return {
    id: init.id,
    name: init.name ?? 'Тест шаблон',
    protocol: init.protocol ?? { ...DEFAULT_PROTOCOL },
    isPreset: false,
  }
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

const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden')

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  })
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  })
}

describe('useTimerSession', () => {
  beforeEach(async () => {
    await db.sessions.clear()
    vi.useFakeTimers(FAKE_TIMERS)
    beepMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    if (hiddenDescriptor !== undefined) {
      Object.defineProperty(document, 'hidden', hiddenDescriptor)
    } else {
      delete (document as unknown as Record<string, unknown>).hidden
    }
    delete (document as unknown as Record<string, unknown>).visibilityState
  })

  it('старт запускает фазу Подготовка с полным временем', () => {
    const session = useTimerSession()
    session.start(makeTemplate())
    expect(session.active.value).toBe(true)
    expect(session.state.value!.phase).toBe('prepare')
    expect(session.state.value!.remainedMs).toBe(10_000)
    expect(session.paused.value).toBe(false)
    session.abort()
  })

  it('по завершении протокола сессия сохранена со статусом completed', async () => {
    const session = useTimerSession()
    session.start(makeTemplate({ name: 'Прогон' }))
    const sessionTime =
      10_000 + 8 * 30_000 + 400
    await vi.advanceTimersByTimeAsync(sessionTime + 200)
    expect(session.state.value!.phase).toBe('done')
    const [saved] = await sessionsRepo.recent(10)
    expect(saved!.status).toBe('completed')
    expect(saved!.completedRounds).toBe(8)
    expect(saved!.templateName).toBe('Прогон')
    expect(typeof saved!.finishedAt).toBe('number')
    session.abort()
  })

  it('после прерывания сохраняется abandoned с completedRounds и снимками (AC-5)', async () => {
    const session = useTimerSession()
    session.start(makeTemplate({ protocol: { ...DEFAULT_PROTOCOL, rounds: 10 } }))
    await vi.advanceTimersByTimeAsync(10_000 + 3 * 30_000 + 250)
    session.abort()
    expect(session.state.value).toBeNull()
    const [saved] = await sessionsRepo.recent(10)
    expect(saved!.status).toBe('abandoned')
    expect(saved!.completedRounds).toBe(3)
    expect(saved!.templateName).toBe('Тест шаблон')
    expect(saved!.protocolSnapshot.rounds).toBe(10)
  })

  it('пауза глушит время и бипы: не тикает и не пищит, resume продолжает (AC-4)', async () => {
    const session = useTimerSession()
    session.start(makeTemplate())
    beepMock.mockClear()
    await vi.advanceTimersByTimeAsync(10_000 + 251)
    expect(session.state.value!.round).toBe(1)
    session.togglePause()
    expect(session.paused.value).toBe(true)
    const frozen = session.state.value!.remainedMs
    beepMock.mockClear()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(session.state.value!.remainedMs).toBe(frozen)
    expect(beepMock).not.toHaveBeenCalled()
    session.togglePause()
    expect(session.paused.value).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(session.state.value!.remainedMs).toBe(frozen - 1_000)
    session.abort()
  })

  it('отсчёт 3-2-1 — по низкому бипу, смена — высокий/restStart, финал — три бипа (AC-8)', async () => {
    const session = useTimerSession()
    session.start(makeTemplate())
    beepMock.mockClear()
    await vi.advanceTimersByTimeAsync(260_000)
    expect(session.state.value!.phase).toBe('done')
    const types = beepMock.mock.calls.map((c) => c[1] as string)
    expect(types.filter((t) => t === 'tickLow')).toHaveLength(3 * 17)
    expect(types.filter((t) => t === 'phaseSwitchHigh')).toHaveLength(8)
    expect(types.filter((t) => t === 'restStart')).toHaveLength(8)
    expect(types.filter((t) => t === 'sessionFinish')).toHaveLength(1)
    session.abort()
  })

  it('сброс возвращает в Подготовку и не сохраняет лишних сессий', async () => {
    const session = useTimerSession()
    session.start(makeTemplate())
    await vi.advanceTimersByTimeAsync(10_000 + 5_000)
    session.resetSession()
    expect(session.state.value!.phase).toBe('prepare')
    expect(session.state.value!.remainedMs).toBe(10_000)
    await vi.advanceTimersByTimeAsync(500)
    expect(await db.sessions.count()).toBe(0)
    session.abort()
    expect(await db.sessions.count()).toBe(1)
  })

  it('скрытие вкладки НЕ завершает сессию; pagehide сохраняет abandoned (FR-4/H1)', async () => {
    const session = useTimerSession()
    session.start(makeTemplate({ protocol: { ...DEFAULT_PROTOCOL, rounds: 10 } }))
    await vi.advanceTimersByTimeAsync(10_000 + 2 * 30_000 + 250)
    expect(session.state.value!.completedRounds).toBe(2)
    setHidden(true)
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(1)
    expect(session.active.value).toBe(true)
    expect(session.state.value!.phase).toBe('work')
    expect(await db.sessions.count()).toBe(0)
    setHidden(false)
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(1)
    const records = await sessionsRepo.recent(10)
    expect(records).toHaveLength(1)
    expect(records[0]!.status).toBe('abandoned')
    expect(records[0]!.completedRounds).toBe(2)
    expect(session.active.value).toBe(false)
  })

  it('повторный pagehide не плодит дубликаты abandoned (H1)', async () => {
    const session = useTimerSession()
    session.start(makeTemplate({ protocol: { ...DEFAULT_PROTOCOL, rounds: 10 } }))
    await vi.advanceTimersByTimeAsync(10_000 + 30_000 + 250)
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(1)
    expect(await db.sessions.count()).toBe(1)
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(1)
    expect(await db.sessions.count()).toBe(1)
  })

  it('pagehide сохраняет abandoned с фактическим completedRounds (H1)', async () => {
    const session = useTimerSession()
    session.start(makeTemplate({ protocol: { ...DEFAULT_PROTOCOL, rounds: 10 } }))
    await vi.advanceTimersByTimeAsync(10_000 + 30_000 + 250)
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(1)
    expect(session.state.value).toBeNull()
    const records = await sessionsRepo.recent(10)
    expect(records).toHaveLength(1)
    expect(records[0]!.status).toBe('abandoned')
    expect(records[0]!.completedRounds).toBe(1)
    setHidden(false)
  })

  it('отсчёт коротких фаз (< 3 с): tickLow на каждой полной секунде фазы (L5)', async () => {
    const session = useTimerSession()
    session.start(
      makeTemplate({
        protocol: {
          ...DEFAULT_PROTOCOL,
          prepareSec: 2,
          workSec: 1,
          restSec: 1,
          rounds: 2,
          cycles: 1,
        },
      }),
    )
    beepMock.mockClear()
    await vi.advanceTimersByTimeAsync(2_000 + 2 * (1_000 + 1_000) + 100)
    expect(session.state.value!.phase).toBe('done')
    const types = beepMock.mock.calls.map((c) => c[1] as string)
    expect(types.filter((t) => t === 'tickLow')).toHaveLength(6)
    expect(types.filter((t) => t === 'phaseSwitchHigh')).toHaveLength(2)
    expect(types.filter((t) => t === 'restStart')).toHaveLength(2)
    expect(types.filter((t) => t === 'sessionFinish')).toHaveLength(1)
    session.abort()
  })
})
