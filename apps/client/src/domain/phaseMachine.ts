import type { TabataProtocol } from './protocol'

export type PhaseKind = 'prepare' | 'work' | 'rest' | 'restBetweenCycles' | 'done'

export interface MachineState {
  protocol: TabataProtocol
  phase: PhaseKind
  phaseIndex: number
  round: number
  cycle: number
  phaseEndsAt: number
  remainedMs: number
  completedRounds: number
  pausedAt: number | null
}

export function createMachine(p: TabataProtocol, now: () => number): MachineState {
  const nowMs = now()
  const prepareMs = p.prepareSec * 1000
  return {
    protocol: p,
    phase: 'prepare',
    phaseIndex: 0,
    round: 1,
    cycle: 1,
    phaseEndsAt: nowMs + prepareMs,
    remainedMs: prepareMs,
    completedRounds: 0,
    pausedAt: null,
  }
}

function advance(s: MachineState): MachineState {
  const p = s.protocol
  const phaseStart = s.phaseEndsAt
  const base = { ...s, phaseIndex: s.phaseIndex + 1 }
  switch (s.phase) {
    case 'prepare':
      return {
        ...base,
        phase: 'work',
        round: 1,
        cycle: 1,
        phaseEndsAt: phaseStart + p.workSec * 1000,
        remainedMs: p.workSec * 1000,
      }
    case 'work':
      return {
        ...base,
        phase: 'rest',
        completedRounds: (s.cycle - 1) * p.rounds + s.round,
        phaseEndsAt: phaseStart + p.restSec * 1000,
        remainedMs: p.restSec * 1000,
      }
    case 'rest': {
      if (s.round < p.rounds) {
        return {
          ...base,
          phase: 'work',
          round: s.round + 1,
          phaseEndsAt: phaseStart + p.workSec * 1000,
          remainedMs: p.workSec * 1000,
        }
      }
      if (s.cycle < p.cycles) {
        return {
          ...base,
          phase: 'restBetweenCycles',
          phaseEndsAt: phaseStart + p.restBetweenCyclesSec * 1000,
          remainedMs: p.restBetweenCyclesSec * 1000,
        }
      }
      return {
        ...base,
        phase: 'done',
        completedRounds: p.rounds * p.cycles,
        phaseEndsAt: phaseStart,
        remainedMs: 0,
      }
    }
    case 'restBetweenCycles':
      return {
        ...base,
        phase: 'work',
        round: 1,
        cycle: s.cycle + 1,
        phaseEndsAt: phaseStart + p.workSec * 1000,
        remainedMs: p.workSec * 1000,
      }
    case 'done':
      return s
  }
}

export function tick(s: MachineState, now: number): MachineState {
  if (s.pausedAt !== null || s.phase === 'done') return s
  if (now < s.phaseEndsAt) return { ...s, remainedMs: s.phaseEndsAt - now }
  let current = s
  while (current.phase !== 'done' && now >= current.phaseEndsAt) {
    current = advance(current)
  }
  return { ...current, remainedMs: Math.max(0, current.phaseEndsAt - now) }
}

export function pause(s: MachineState, now: number): MachineState {
  if (s.pausedAt !== null || s.phase === 'done') return s
  return { ...s, pausedAt: now }
}

export function resume(s: MachineState, now: number): MachineState {
  if (s.pausedAt === null) return s
  return { ...s, pausedAt: null, phaseEndsAt: s.phaseEndsAt + (now - s.pausedAt) }
}

export function reset(p: TabataProtocol, now: number): MachineState {
  return createMachine(p, () => now)
}

export function hasFinished(s: MachineState): boolean {
  return s.phase === 'done'
}
