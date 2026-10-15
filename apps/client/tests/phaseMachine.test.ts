import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMachine,
  hasFinished,
  pause,
  reset,
  resume,
  tick,
  type MachineState,
  type PhaseKind,
} from '../src/domain/phaseMachine'
import { DEFAULT_PROTOCOL, type TabataProtocol } from '../src/domain/protocol'

const A = DEFAULT_PROTOCOL
const B: TabataProtocol = { ...DEFAULT_PROTOCOL, cycles: 2 }

interface TimelineSegment {
  phase: PhaseKind
  start: number
  end: number
  round: number
  cycle: number
}

function buildTimeline(p: TabataProtocol): TimelineSegment[] {
  const segments: TimelineSegment[] = []
  let t = 0
  segments.push({ phase: 'prepare', start: 0, end: (t += p.prepareSec * 1000), round: 1, cycle: 1 })
  for (let c = 1; c <= p.cycles; c += 1) {
    for (let r = 1; r <= p.rounds; r += 1) {
      segments.push({
        phase: 'work',
        start: t,
        end: (t += p.workSec * 1000),
        round: r,
        cycle: c,
      })
      segments.push({
        phase: 'rest',
        start: t,
        end: (t += p.restSec * 1000),
        round: r,
        cycle: c,
      })
    }
    if (c < p.cycles) {
      segments.push({
        phase: 'restBetweenCycles',
        start: t,
        end: (t += p.restBetweenCyclesSec * 1000),
        round: p.rounds,
        cycle: c,
      })
    }
  }
  segments.push({
    phase: 'done',
    start: t,
    end: t,
    round: p.rounds,
    cycle: p.cycles,
  })
  return segments
}

function segmentAt(timeline: TimelineSegment[], t: number): TimelineSegment {
  for (const segment of timeline) {
    if (t < segment.end) return segment
  }
  return timeline[timeline.length - 1]!
}

function run(p: TabataProtocol, totalMs: number, stepMs: number): Map<number, MachineState> {
  const samples = new Map<number, MachineState>()
  let s = createMachine(p, () => 0)
  samples.set(0, s)
  for (let t = stepMs; t <= totalMs; t += stepMs) {
    s = tick(s, t)
    samples.set(t, s)
  }
  return samples
}

describe('createMachine', () => {
  it('стартует с фазы Подготовка на prepareSec (AC-1)', () => {
    const s = createMachine(A, () => 5_000)
    expect(s.phase).toBe('prepare')
    expect(s.phaseIndex).toBe(0)
    expect(s.round).toBe(1)
    expect(s.cycle).toBe(1)
    expect(s.remainedMs).toBe(10_000)
    expect(s.phaseEndsAt).toBe(15_000)
    expect(s.completedRounds).toBe(0)
    expect(s.pausedAt).toBeNull()
    expect(hasFinished(s)).toBe(false)
  })
})

describe('tick: цикл = 1 (AC-1, AC-3)', () => {
  it('prepare → 8 × (work → rest) → done, restBetweenCycles не наступает', () => {
    const samples = run(A, 251_000, 250)
    const finished = [...samples.values()].find((s) => hasFinished(s))
    expect(finished).toBeDefined()
    expect(finished!.phase).toBe('done')
    expect(finished!.completedRounds).toBe(8)
    expect(finished!.phaseIndex).toBe(17)
    for (const s of samples.values()) {
      expect(s.phase).not.toBe('restBetweenCycles')
    }
  })

  it('границы фаз точны: 10 с подготовки, 20 с работы, 10 с отдыха', () => {
    let s = createMachine(A, () => 0)
    s = tick(s, 9_999)
    expect(s.phase).toBe('prepare')
    expect(s.remainedMs).toBe(1)
    s = tick(s, 10_000)
    expect(s.phase).toBe('work')
    expect(s.remainedMs).toBe(20_000)
    s = tick(s, 29_999)
    expect(s.phase).toBe('work')
    expect(s.remainedMs).toBe(1)
    s = tick(s, 30_000)
    expect(s.phase).toBe('rest')
    expect(s.remainedMs).toBe(10_000)
    s = tick(s, 39_999)
    expect(s.phase).toBe('rest')
    expect(s.remainedMs).toBe(1)
    s = tick(s, 50_000)
    expect(s.phase).toBe('work')
    expect(s.round).toBe(2)
  })

  it('completedRounds инкрементируется при входе в отдых, у done — все 8', () => {
    let s = createMachine(A, () => 0)
    s = tick(s, 29_999)
    expect(s.completedRounds).toBe(0)
    s = tick(s, 30_000)
    expect(s.phase).toBe('rest')
    expect(s.completedRounds).toBe(1)
    const samples = run(A, 250_000, 250)
    const rest8Start = 10_000 + 7 * 30_000 + 20_000
    expect(samples.get(rest8Start)!.phase).toBe('rest')
    expect(samples.get(rest8Start)!.round).toBe(8)
    expect(samples.get(rest8Start)!.completedRounds).toBe(8)
    expect(samples.get(250_000)!.phase).toBe('done')
    expect(samples.get(250_000)!.completedRounds).toBe(8)
  })

  it('completedRounds корректен при прерывании на середине раунда (AC-5)', () => {
    const samples = run(A, 221_000, 250)
    const midWork4 = 10_000 + 3 * 30_000 + 7_000
    expect(samples.get(midWork4)!.phase).toBe('work')
    expect(samples.get(midWork4)!.round).toBe(4)
    expect(samples.get(midWork4)!.completedRounds).toBe(3)
  })

  it('buildTimeline согласован с машиной по всей длине протокола', () => {
    const timeline = buildTimeline(A)
    for (const [t, s] of run(A, timeline[timeline.length - 1]!.end + 500, 250).entries()) {
      const segment = segmentAt(timeline, t)
      expect(s.phase).toBe(segment.phase)
      expect(s.round).toBe(segment.round)
      expect(s.cycle).toBe(segment.cycle)
      if (segment.phase !== 'done') {
        expect(s.phaseEndsAt).toBe(segment.end)
        expect(s.remainedMs).toBe(segment.end - t)
      }
    }
  })
})

describe('tick: циклы = 2 (AC-2)', () => {
  it('после 8-го раунда цикла 1 наступает Отдых между циклами на 60 с', () => {
    const restBetweenStart = 10_000 + 8 * 30_000
    const samples = run(B, restBetweenStart + 70_000, 500)
    expect(samples.get(restBetweenStart - 500)!.phase).toBe('rest')
    expect(samples.get(restBetweenStart - 500)!.completedRounds).toBe(8)
    expect(samples.get(restBetweenStart)!.phase).toBe('restBetweenCycles')
    expect(samples.get(restBetweenStart)!.remainedMs).toBe(60_000)
    let s = createMachine(B, () => 0)
    s = tick(s, restBetweenStart)
    expect(s.phase).toBe('restBetweenCycles')
    s = tick(s, restBetweenStart + 59_999)
    expect(s.phase).toBe('restBetweenCycles')
    expect(s.remainedMs).toBe(1)
    s = tick(s, restBetweenStart + 60_000)
    expect(s.phase).toBe('work')
    expect(s.round).toBe(1)
    expect(s.cycle).toBe(2)
    expect(s.completedRounds).toBe(8)
  })

  it('после 16-го раунда — Завершение (AC-2)', () => {
    const total = 10_000 + 2 * 8 * 30_000 + 60_000
    const samples = run(B, total + 1_000, 1_000)
    expect(samples.get(total - 1_000)!.phase).toBe('rest')
    expect(samples.get(total)!.phase).toBe('done')
    expect(samples.get(total)!.completedRounds).toBe(16)
    expect(samples.get(total)!.phaseIndex).toBe(34)
  })

  it('buildTimeline согласован с машиной по всей длине протокола', () => {
    const timeline = buildTimeline(B)
    for (const [t, s] of run(B, timeline[timeline.length - 1]!.end + 500, 500).entries()) {
      const segment = segmentAt(timeline, t)
      expect(s.phase).toBe(segment.phase)
      expect(s.round).toBe(segment.round)
      expect(s.cycle).toBe(segment.cycle)
      if (segment.phase !== 'done') {
        expect(s.phaseEndsAt).toBe(segment.end)
      }
    }
  })
})

describe('pause/resume (AC-4)', () => {
  it('отсчёт замирает и продолжается с того же remainedMs', () => {
    let s = createMachine(A, () => 0)
    s = tick(s, 18_000)
    expect(s.phase).toBe('work')
    expect(s.remainedMs).toBe(12_000)
    const pausedState = pause(s, 18_000)
    expect(pausedState.pausedAt).toBe(18_000)
    expect(tick(pausedState, 25_000)).toBe(pausedState)
    expect(tick(pausedState, 100_000)).toBe(pausedState)
    const resumed = resume(pausedState, 32_000)
    expect(resumed.pausedAt).toBeNull()
    expect(resumed.remainedMs).toBe(12_000)
    const after = tick(resumed, 32_200)
    expect(after.phase).toBe('work')
    expect(after.remainedMs).toBe(11_800)
    const end = tick(after, 44_000)
    expect(end.phase).toBe('rest')
    expect(end.phaseEndsAt).toBe(54_000)
  })

  it('phaseEndsAt смещается ровно на длительность паузы — дрейфа нет', () => {
    let s = createMachine(A, () => 0)
    s = tick(s, 3_000)
    const before = s.phaseEndsAt
    const resumed = resume(pause(s, 4_444), 9_999)
    expect(resumed.phaseEndsAt).toBe(before + 5_555)
  })

  it('повторная пауза и resume без паузы безопасны', () => {
    let s = createMachine(A, () => 0)
    s = tick(s, 1_000)
    const pausedState = pause(s, 2_000)
    expect(pause(pausedState, 3_000)).toBe(pausedState)
    expect(resume(s, 3_000)).toBe(s)
  })
})

describe('reset/hasFinished', () => {
  it('reset возвращает к фазе Подготовка в начало протокола', () => {
    const fresh = reset(A, 777)
    expect(fresh.phase).toBe('prepare')
    expect(fresh.remainedMs).toBe(A.prepareSec * 1000)
    expect(fresh.phaseEndsAt).toBe(777 + A.prepareSec * 1000)
    expect(fresh.completedRounds).toBe(0)
    expect(fresh.phaseIndex).toBe(0)
    expect(fresh.cycle).toBe(1)
  })

  it('hasFinished ложен в активных фазах и истинен на done', () => {
    let s = createMachine(A, () => 0)
    expect(hasFinished(s)).toBe(false)
    for (const t of [10_000, 15_000, 100_000]) {
      s = tick(s, t)
      expect(hasFinished(s)).toBe(false)
    }
    s = tick(s, 250_000)
    expect(hasFinished(s)).toBe(true)
  })
})

describe('дрейф хода времени: 30 минут с fake timers (NFR-1, AC-11)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('максимальное отклонение от эталонного расписания < 50 мс, 5 пауз в случайные моменты', () => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
        'performance',
      ],
    })
    const protocol: TabataProtocol = {
      prepareSec: 10,
      workSec: 25,
      restSec: 10,
      rounds: 30,
      cycles: 2,
      restBetweenCyclesSec: 60,
    }
    const timeline = buildTimeline(protocol)
    const THIRTY_MIN = 30 * 60 * 1000
    expect(timeline[timeline.length - 1]!.end).toBeGreaterThan(THIRTY_MIN)

    let s = createMachine(protocol, () => performance.now())
    let shiftMs = 0
    let pausesLeft = 5
    const pauseSessionTimes = [10_137, 40_441, 111_017, 230_409, 500_121]
    let maxDeviation = 0
    const stepMs = 250

    while (performance.now() < THIRTY_MIN) {
      const nowMs = performance.now()
      if (pausesLeft > 0 && nowMs >= pauseSessionTimes[0]!) {
        const target = pauseSessionTimes.shift()!
        s = pause(s, nowMs)
        const lag = Math.max(1, target - nowMs)
        vi.advanceTimersByTime(lag)
        s = resume(s, performance.now())
        shiftMs += performance.now() - nowMs
        pausesLeft -= 1
      }
      vi.advanceTimersByTime(stepMs)
      s = tick(s, performance.now())
      if (hasFinished(s)) continue
      const sessionTime = performance.now() - shiftMs
      const segment = segmentAt(timeline, sessionTime)
      expect(segment.phase).not.toBe('done')
      expect(s.phase).toBe(segment.phase)
      maxDeviation = Math.max(maxDeviation, Math.abs(s.phaseEndsAt - (segment.end + shiftMs)))
    }
    expect(pausesLeft).toBe(0)
    expect(maxDeviation).toBeLessThan(50)
  })

  it('неровные интервалы тиков не накапливают дрейф (< 50 мс за полное время протокола)', () => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
        'performance',
      ],
    })
    let s = createMachine(B, () => performance.now())
    const timeline = buildTimeline(B)
    let seed = 42
    let maxDeviation = 0
    while (!hasFinished(s)) {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      const step = 100 + Math.floor((seed / 2_147_483_648) * 900)
      vi.advanceTimersByTime(step)
      s = tick(s, performance.now())
      if (hasFinished(s)) break
      const segment = segmentAt(timeline, performance.now())
      maxDeviation = Math.max(maxDeviation, Math.abs(s.phaseEndsAt - segment.end))
    }
    expect(maxDeviation).toBeLessThan(50)
  })
})
