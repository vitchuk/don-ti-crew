<script setup lang="ts">
import { ref } from 'vue'
import HistoryScreen from './components/HistoryScreen.vue'
import SetupScreen from './components/SetupScreen.vue'
import TemplateListScreen from './components/TemplateListScreen.vue'
import TimerScreen from './components/TimerScreen.vue'
import { useTimerSession } from './composables/useTimerSession'
import type { WorkoutTemplate } from './db/db'

type Screen = 'templates' | 'setup' | 'history' | 'timer'

const screen = ref<Screen>('templates')
const editableTemplate = ref<WorkoutTemplate | null>(null)
const session = useTimerSession()

function startSession(template: WorkoutTemplate): void {
  session.start(template)
  screen.value = 'timer'
}

function openSetup(template?: WorkoutTemplate): void {
  editableTemplate.value = template ?? null
  screen.value = 'setup'
}

function closeSetup(): void {
  screen.value = 'templates'
}

function exitTimer(): void {
  screen.value = 'templates'
}
</script>

<template>
  <TemplateListScreen
    v-if="screen === 'templates'"
    @start="startSession"
    @edit="openSetup"
    @create="openSetup()"
    @history="screen = 'history'"
  />
  <SetupScreen
    v-else-if="screen === 'setup'"
    :template="editableTemplate"
    @close="closeSetup"
  />
  <HistoryScreen v-else-if="screen === 'history'" @close="screen = 'templates'" />
  <TimerScreen v-else-if="screen === 'timer'" @exit="exitTimer" />
</template>
