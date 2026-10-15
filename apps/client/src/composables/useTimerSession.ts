import { computed, ref } from 'vue'
import { beep, getAudioContext } from '../audio/audioCues'
import {
  type SessionStatus,
  type TrainingSession,
  type WorkoutTemplate,
} from '../db/db'
import { sessionsRepo } from '../db/repositories'
import { beepsForTransition, type BeepType } from '../domain/beepPlan'
import {
  createMachine,
  hasFinished,
  pause,
  reset,
  resume,
  tick,
  type MachineState,
  type PhaseKind,
} from '../domain/phaseMachine'
import type { TabataProtocol } from '../domain/protocol'

const state = ref<MachineState | null>(null)
const activeTemplate = ref<WorkoutTemplate | null>(null)
const startedAt = ref(0)

let intervalId: number | null = null
let audioContext: AudioContext | null = null
let lastCountdownKey: string | null = null
let lifecycleAttached = false

const active = computed(() => state.value !== null)
const paused = computed(() => state.value !== null && state.value.pausedAt !== null)

function clearTimer(): void {
  if (intervalId !== null) {
    window.clearInterval(intervalId)
    intervalId = null
  }
}

function playPlan(plan: BeepType[]): void {
  for (const type of plan) {
    beep(audioContext, type)
  }
}

function playCountdown(next: MachineState): void {
  const sec = Math.ceil(next.remainedMs / 1000)
  const countdownSecs = Math.min(3, phaseTotalSec(next.protocol, next.phase))
  if (sec <= 0 || sec > countdownSecs) return
  const key = `${next.phaseIndex}:${sec}`
  if (key === lastCountdownKey) return
  beep(audioContext, 'tickLow')
  lastCountdownKey = key
}

function phaseTotalSec(protocol: TabataProtocol, phase: PhaseKind): number {
  switch (phase) {
    case 'prepare':
      return protocol.prepareSec
    case 'work':
      return protocol.workSec
    case 'rest':
      return protocol.restSec
    case 'restBetweenCycles':
      return protocol.restBetweenCyclesSec
    case 'done':
      return 0
  }
}

function persist(
  status: SessionStatus,
  template: WorkoutTemplate,
  completedRounds: number,
  sessionStartedAt: number,
): void {
  const record: TrainingSession = {
    startedAt: sessionStartedAt,
    finishedAt: Date.now(),
    templateId: template.id,
    templateName: template.name,
    protocolSnapshot: { ...template.protocol },
    completedRounds,
    status,
  }
  void sessionsRepo.save(record).catch(() => {
    console.warn('Не удалось сохранить сессию')
  })
}

function loop(): void {
  const current = state.value
  if (current === null || current.pausedAt !== null) return
  const previous = current
  const now = performance.now()
  const next = tick(current, now)
  if (next === previous) return
  state.value = next
  playPlan(beepsForTransition(previous, next, next.protocol))
  if (!hasFinished(next)) {
    playCountdown(next)
    return
  }
  clearTimer()
  if (activeTemplate.value !== null) {
    persist('completed', activeTemplate.value, next.completedRounds, startedAt.value)
  }
  detachLifecycle()
}

function abandonSession(): void {
  const current = state.value
  const template = activeTemplate.value
  clearTimer()
  detachLifecycle()
  if (current !== null && template !== null && !hasFinished(current)) {
    persist('abandoned', template, current.completedRounds, startedAt.value)
  }
  state.value = null
  activeTemplate.value = null
  lastCountdownKey = null
}

function handlePageHide(): void {
  abandonSession()
}

function attachLifecycle(): void {
  if (lifecycleAttached) return
  window.addEventListener('pagehide', handlePageHide)
  lifecycleAttached = true
}

function detachLifecycle(): void {
  if (!lifecycleAttached) return
  window.removeEventListener('pagehide', handlePageHide)
  lifecycleAttached = false
}

export function useTimerSession() {
  function start(template: WorkoutTemplate): void {
    if (intervalId !== null) return
    detachLifecycle()
    audioContext = getAudioContext()
    activeTemplate.value = { ...template, protocol: { ...template.protocol } }
    startedAt.value = Date.now()
    state.value = createMachine(activeTemplate.value.protocol, () => performance.now())
    lastCountdownKey = null
    intervalId = window.setInterval(loop, 200)
    attachLifecycle()
  }

  function togglePause(): void {
    const current = state.value
    if (current === null || hasFinished(current)) return
    if (current.pausedAt !== null) {
      audioContext = getAudioContext()
      state.value = resume(current, performance.now())
    } else {
      state.value = pause(current, performance.now())
    }
  }

  function resetSession(): void {
    const template = activeTemplate.value
    if (template === null) return
    startedAt.value = Date.now()
    state.value = reset(template.protocol, performance.now())
    lastCountdownKey = null
  }

  function abort(): void {
    abandonSession()
  }

  return {
    active,
    paused,
    state,
    start,
    togglePause,
    resetSession,
    abort,
  }
}
