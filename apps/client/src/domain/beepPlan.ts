import type { MachineState } from './phaseMachine'
import type { TabataProtocol } from './protocol'

export type BeepType = 'tickLow' | 'phaseSwitchHigh' | 'restStart' | 'sessionFinish'

export function beepsForTransition(
  prev: MachineState,
  next: MachineState,
  proto: TabataProtocol,
): BeepType[] {
  void proto
  if (prev.phase === next.phase) return []
  if (next.phase === 'done') return ['sessionFinish']
  if (next.phase === 'work') return ['phaseSwitchHigh']
  if (next.phase === 'rest' || next.phase === 'restBetweenCycles') return ['restStart']
  return []
}
