<script setup lang="ts">
import { onMounted } from 'vue'
import { useHistory } from '../composables/useHistory'
import type { TrainingSession } from '../db/db'

const { sessions, refresh } = useHistory()
const emit = defineEmits<{ close: [] }>()

onMounted(() => {
  void refresh()
})

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function dateLabel(session: TrainingSession): string {
  return dateFormat.format(new Date(session.startedAt))
}

function statusLabel(session: TrainingSession): string {
  return session.status === 'completed' ? 'Завершена' : 'Прервана'
}

function roundsLabel(session: TrainingSession): string {
  const p = session.protocolSnapshot
  const label = `Раунды: ${session.completedRounds} из ${p.rounds}`
  return p.cycles > 1 ? `${label} · циклов: ${p.cycles}` : label
}
</script>

<template>
  <main class="screen history-screen">
    <header class="screen-header">
      <h1 class="screen-title">История</h1>
      <button class="btn btn-ghost" type="button" @click="emit('close')">Назад</button>
    </header>
    <ul class="history-list">
      <li v-if="sessions.length === 0" class="history-empty">Сессий пока нет</li>
      <li v-for="s in sessions" :key="s.id" class="history-card">
        <span class="history-name">{{ s.templateName }}</span>
        <span class="history-date">{{ dateLabel(s) }}</span>
        <span class="history-rounds">{{ roundsLabel(s) }}</span>
        <span class="history-status" :data-status="s.status">{{ statusLabel(s) }}</span>
      </li>
    </ul>
  </main>
</template>
