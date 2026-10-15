<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useTemplates } from '../composables/useTemplates'
import type { WorkoutTemplate } from '../db/db'
import {
  DEFAULT_PROTOCOL,
  validateProtocol,
  type TabataProtocol,
  type ValidationError,
} from '../domain/protocol'

const props = defineProps<{ template?: WorkoutTemplate | null }>()
const emit = defineEmits<{ close: [] }>()

const { createTemplate, renameTemplate, removeTemplate } = useTemplates()

const editingId = computed(() => props.template?.id ?? null)
const name = ref(props.template?.name ?? '')
const protocol = reactive<TabataProtocol>({ ...(props.template?.protocol ?? DEFAULT_PROTOCOL) })
const submitted = ref(false)
const saving = ref(false)
const saveError = ref('')

const FIELDS: { key: keyof TabataProtocol; label: string }[] = [
  { key: 'prepareSec', label: 'Подготовка, с' },
  { key: 'workSec', label: 'Работа, с' },
  { key: 'restSec', label: 'Отдых, с' },
  { key: 'rounds', label: 'Раунды' },
  { key: 'cycles', label: 'Циклы' },
  { key: 'restBetweenCyclesSec', label: 'Отдых между циклами, с' },
]

const errors = computed<ValidationError[]>(() => validateProtocol(protocol))
const nameError = computed(() => (name.value.trim() === '' ? 'Введите имя шаблона' : ''))
const blocked = computed(() => errors.value.length > 0 || nameError.value !== '')

async function save(): Promise<void> {
  submitted.value = true
  if (blocked.value || saving.value) return
  try {
    saving.value = true
    if (editingId.value !== null) {
      await renameTemplate(editingId.value, name.value.trim())
    } else {
      await createTemplate(name.value.trim(), { ...protocol })
    }
  } catch {
    saveError.value = 'Не удалось сохранить шаблон'
    return
  } finally {
    saving.value = false
  }
  emit('close')
}

async function remove(): Promise<void> {
  const id = editingId.value
  if (id === null) return
  try {
    saving.value = true
    await removeTemplate(id)
  } catch {
    saveError.value = 'Не удалось удалить шаблон'
    return
  } finally {
    saving.value = false
  }
  emit('close')
}
</script>

<template>
  <main class="screen setup-screen">
    <header class="screen-header">
      <h1 class="screen-title">{{ editingId === null ? 'Новый шаблон' : 'Изменить шаблон' }}</h1>
      <button class="btn btn-ghost" type="button" @click="emit('close')">Назад</button>
    </header>
    <form class="setup-form" @submit.prevent="save">
      <div class="setup-field">
        <label class="field-label" for="field-name">Имя шаблона</label>
        <input
          id="field-name"
          v-model="name"
          class="field-input"
          type="text"
          placeholder="Например: Табата 30/10"
        />
        <p v-if="submitted && nameError !== ''" class="field-error">{{ nameError }}</p>
      </div>
      <p v-if="editingId !== null" class="setup-protocol-hint">
        Протокол шаблона неизменяем. Создайте новый шаблон, если нужен другой протокол.
      </p>
      <div v-for="field in FIELDS" :key="field.key" class="setup-field">
        <label class="field-label" :for="`field-${field.key}`">{{ field.label }}</label>
        <input
          :id="`field-${field.key}`"
          v-model.number="protocol[field.key]"
          class="field-input"
          type="number"
          inputmode="numeric"
          min="1"
          :disabled="editingId !== null"
        />
      </div>
      <ul v-if="submitted && errors.length > 0" class="setup-errors">
        <li v-for="e in errors" :key="e.field">{{ e.message }}</li>
      </ul>
      <p v-if="saveError !== ''" class="field-error">{{ saveError }}</p>
      <div class="setup-actions">
        <button class="btn btn-primary" type="submit">Сохранить</button>
        <button v-if="editingId !== null" class="btn btn-danger" type="button" @click="remove">
          Удалить
        </button>
      </div>
    </form>
    <p class="setup-protocol-hint">Отдых между циклами используется, только если циклов больше одного.</p>
  </main>
</template>
