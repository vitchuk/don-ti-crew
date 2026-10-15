<script setup lang="ts">
import { onMounted } from 'vue'
import { useTemplates } from '../composables/useTemplates'
import type { WorkoutTemplate } from '../db/db'

const { templates, refresh, removeTemplate } = useTemplates()
const emit = defineEmits<{
  start: [template: WorkoutTemplate]
  edit: [template: WorkoutTemplate]
  create: []
  history: []
}>()

onMounted(() => {
  void refresh()
})

function summary(template: WorkoutTemplate): string {
  const p = template.protocol
  const parts = [
    `${p.workSec}/${p.restSec} с`,
    `раундов: ${p.rounds}`,
  ]
  if (p.cycles > 1) parts.push(`циклов: ${p.cycles}`)
  return parts.join(' · ')
}

async function remove(id: number): Promise<void> {
  await removeTemplate(id)
}
</script>

<template>
  <main class="screen list-screen">
    <header class="screen-header">
      <h1 class="screen-title">Шаблоны тренировок</h1>
      <button class="btn btn-ghost" type="button" @click="emit('history')">История</button>
    </header>
    <ul class="template-list">
      <li v-for="t in templates" :key="`${t.name}-${t.id ?? 'preset'}`" class="template-card">
        <button class="template-start" type="button" @click="emit('start', t)">
          <span class="template-name">{{ t.name }}</span>
          <span class="template-summary">{{ summary(t) }}</span>
        </button>
        <div v-if="!t.isPreset" class="template-actions">
          <button class="btn btn-ghost" type="button" @click="emit('edit', t)">Изменить</button>
          <button
            v-if="t.id !== undefined"
            class="btn btn-ghost"
            type="button"
            @click="remove(t.id)"
          >
            Удалить
          </button>
        </div>
      </li>
    </ul>
    <button class="btn btn-primary" type="button" @click="emit('create')">Новый шаблон</button>
  </main>
</template>
