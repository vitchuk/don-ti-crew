import { describe, expect, it } from 'vitest'
import { beepsForTransition } from '../src/domain/beepPlan'
import { createMachine, hasFinished, tick, type MachineState } from '../src/domain/phaseMachine'
import { DEFAULT_PROTOCOL, type TabataProtocol } from '../src/domain/protocol'

const FAST: TabataProtocol = {
  prepareSec: 1,
  workSec: 1,
  restSec: 1,
  rounds: 2,
  cycles: 2,
  restBetweenCyclesSec: 2,
}

function stepTo(s: MachineState, t: number): [MachineState, MachineState] {
  const prev = s
  return [prev, tick(prev, t)]
}

describe('beepsForTransition', () => {
  it('внутри фазы (перехода нет) план пуст — нет ложных и двойных бипов', () => {
    let s = createMachine(FAST, () => 0)
    const before = s
    s = tick(s, 400)
    expect(beepsForTransition(before, s, FAST)).toEqual([])
    expect(beepsForTransition(s, s, FAST)).toEqual([])
  })

  it('подготовка → работа: один высокий бип (сигнал старта работы совпадает со сменой)', () => {
    const [prev, next] = stepTo(createMachine(FAST, () => 0), 1_000)
    expect(next.phase).toBe('work')
    expect(beepsForTransition(prev, next, FAST)).toEqual(['phaseSwitchHigh'])
  })

  it('работа → отдых: два средних бипа (старт отдыха) без высокого', () => {
    let prev = createMachine(FAST, () => 0)
    prev = tick(prev, 1_000)
    const [p, next] = stepTo(prev, 2_000)
    expect(next.phase).toBe('rest')
    const plan = beepsForTransition(p, next, FAST)
    expect(plan).toEqual(['restStart'])
    expect(plan).not.toContain('phaseSwitchHigh')
  })

  it('отдых последнего раунда цикла → отдых между циклами: два средних бипа', () => {
    let prev = createMachine(FAST, () => 0)
    prev = tick(prev, 1_000)
    prev = tick(prev, 2_000)
    prev = tick(prev, 3_000)
    prev = tick(prev, 4_000)
    expect(prev.phase).toBe('rest')
    const [p, next] = stepTo(prev, 5_000)
    expect(next.phase).toBe('restBetweenCycles')
    expect(beepsForTransition(p, next, FAST)).toEqual(['restStart'])
  })

  it('отдых между циклами → работа следующего цикла: высокий бип', () => {
    let prev = createMachine(FAST, () => 0)
    for (const t of [1_000, 2_000, 3_000, 4_000, 5_000]) {
      prev = tick(prev, t)
    }
    expect(prev.phase).toBe('restBetweenCycles')
    const [p, next] = stepTo(prev, 7_000)
    expect(next.phase).toBe('work')
    expect(next.round).toBe(1)
    expect(next.cycle).toBe(2)
    expect(beepsForTransition(p, next, FAST)).toEqual(['phaseSwitchHigh'])
  })

  it('любая фаза → done: три бипа завершения (AC-8)', () => {
    let prev = createMachine(FAST, () => 0)
    for (const t of [1_000, 2_000, 3_000, 4_000, 5_000, 7_000, 8_000, 9_000, 10_000]) {
      prev = tick(prev, t)
    }
    expect(prev.phase).toBe('rest')
    const [p, next] = stepTo(prev, 11_000)
    expect(next.phase).toBe('done')
    expect(hasFinished(next)).toBe(true)
    expect(beepsForTransition(p, next, FAST)).toEqual(['sessionFinish'])
  })

  it('полный прогон циклов=2 даёт ровные количества бипов (двойного подсчёта нет)', () => {
    let s = createMachine(FAST, () => 0)
    const counts = new Map<string, number>([
      ['phaseSwitchHigh', 0],
      ['restStart', 0],
      ['sessionFinish', 0],
      ['tickLow', 0],
    ])
    while (!hasFinished(s)) {
      const prev = s
      s = tick(s, s.phaseEndsAt)
      for (const t of beepsForTransition(prev, s, FAST)) {
        counts.set(t, counts.get(t)! + 1)
      }
    }
    expect(s.completedRounds).toBe(4)
    expect(counts.get('phaseSwitchHigh')).toBe(4)
    expect(counts.get('restStart')).toBe(5)
    expect(counts.get('sessionFinish')).toBe(1)
  })
})
