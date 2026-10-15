<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTimerSession } from '../composables/useTimerSession'
import { hasFinished, type PhaseKind } from '../domain/phaseMachine'

const { state, paused, togglePause, resetSession, abort } = useTimerSession()
const emit = defineEmits<{ exit: [] }>()

const PHASE_LABELS: Record<PhaseKind, string> = {
  prepare: 'Подготовка',
  work: 'Работа',
  rest: 'Отдых',
  restBetweenCycles: 'Отдых между циклами',
  done: 'Завершение',
}

const phaseLabel = computed(() => (state.value === null ? '' : PHASE_LABELS[state.value.phase]))
const protocol = computed(() => state.value?.protocol)
const isDone = computed(() => state.value !== null && hasFinished(state.value))

const timeLabel = computed(() => {
  if (state.value === null) return ''
  if (hasFinished(state.value)) return '00:00'
  const total = Math.ceil(state.value.remainedMs / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

const roundsLabel = computed(() =>
  state.value === null || protocol.value === undefined
    ? ''
    : `Раунд ${state.value.round} из ${protocol.value.rounds}`,
)

const cyclesLabel = computed(() => {
  if (state.value === null || state.value.protocol.cycles <= 1) return ''
  return `Цикл ${state.value.cycle} из ${state.value.protocol.cycles}`
})

const dots = computed<boolean[]>(() => {
  const current = state.value
  if (current === null) return []
  const total = current.protocol.rounds * current.protocol.cycles
  return Array.from({ length: total }, (_, i) => i < current.completedRounds)
})

const confirmStop = ref(false)

function requestStop(): void {
  confirmStop.value = true
}

function confirmStopSave(): void {
  abort()
  confirmStop.value = false
  emit('exit')
}

function cancelStop(): void {
  confirmStop.value = false
}

function exitAfterDone(): void {
  emit('exit')
}
</script>

<template>
  <main v-if="state" class="timer" :data-phase="state.phase">
    <p class="timer-cue">{{ phaseLabel }}</p>
    <p class="timer-value">{{ timeLabel }}</p>
    <p v-if="!isDone" class="timer-meta">
      <span>{{ roundsLabel }}</span>
      <span v-if="protocol !== undefined && protocol.cycles > 1">{{ cyclesLabel }}</span>
    </p>
    <p v-else class="timer-meta"><span>Завершено раундов: {{ state.completedRounds }}</span></p>
    <ul class="timer-progress" aria-label="Прогресс сессии">
      <li v-for="(filled, i) in dots" :key="i" :class="{ 'is-filled': filled }" />
    </ul>
    <div v-if="!isDone && !confirmStop" class="timer-controls">
      <button class="btn btn-primary" type="button" @click="togglePause">
        {{ paused ? 'Продолжить' : 'Пауза' }}
      </button>
      <button class="btn btn-secondary" type="button" @click="resetSession">Сброс</button>
      <button class="btn btn-danger" type="button" @click="requestStop">Стоп</button>
    </div>
    <div v-else-if="!isDone && confirmStop" class="timer-controls">
      <p class="timer-confirm-hint">Сохранить прерванную сессию?</p>
      <button class="btn btn-primary" type="button" @click="confirmStopSave">Сохранить</button>
      <button class="btn btn-secondary" type="button" @click="cancelStop">Продолжить</button>
    </div>
    <div v-else class="timer-controls">
      <button class="btn btn-primary" type="button" @click="exitAfterDone">Готово</button>
    </div>
  </main>
</template>
