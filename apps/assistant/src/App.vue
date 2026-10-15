<script setup lang="ts">
import { onMounted, ref } from 'vue'
import MessageItem from './components/MessageItem.vue'
import { askQuestion, errorText, fetchHealth } from './api'
import { clearHistory, loadHistory, newMessage, saveHistory } from './history'
import type { ChatMessage } from './types'

const maxQuestionLength = 2000
const emptyQuestionHint = 'Вопрос пустой — напишите его в поле ввода.'
const longQuestionHint = `Вопрос длиннее ${maxQuestionLength} символов — сократите его и задайте ещё раз.`

const messages = ref<ChatMessage[]>(loadHistory())
const question = ref('')
const busy = ref(false)
const error = ref('')
/** context.branch последнего ответа — мелкая строка статуса (опционально по спеке). */
const branch = ref('')

onMounted(async () => {
  const health = await fetchHealth()
  if (health === null || health.llm.ready) {
    return
  }
  error.value = errorText(health.llm.provider === 'ollama' ? 'ollama_unavailable' : 'deepseek_key_missing')
})

async function send(): Promise<void> {
  const text = question.value.trim()
  if (text.length === 0) {
    error.value = emptyQuestionHint
    return
  }
  if (text.length > maxQuestionLength) {
    error.value = longQuestionHint
    return
  }
  error.value = ''
  busy.value = true
  pushMessage(newMessage('user', text))
  question.value = ''
  try {
    const answer = await askQuestion(text)
    pushMessage(newMessage('assistant', answer.answer, answer.citations, answer.context))
    if (answer.context !== undefined) {
      branch.value = answer.context.branch
    }
  }
  catch (thrown) {
    error.value = thrown instanceof Error && thrown.message.length > 0
      ? thrown.message
      : 'Неизвестная ошибка — повторите вопрос позже.'
  }
  finally {
    busy.value = false
  }
}

function pushMessage(message: ChatMessage): void {
  messages.value = [...messages.value, message]
  saveHistory(messages.value)
}

/** «Новый вопрос» — чат с чистого листа, включая localStorage (FR-7, AC-9). */
function resetChat(): void {
  messages.value = []
  question.value = ''
  error.value = ''
  branch.value = ''
  clearHistory()
}
</script>

<template>
  <main class="chat">
    <header class="chat-header">
      <div>
        <h1 class="chat-title">Помощник по проекту</h1>
        <p v-if="branch !== ''" class="chat-branch">Ветка: {{ branch }}</p>
      </div>
      <button class="chat-reset" type="button" :disabled="busy" @click="resetChat">Новый вопрос</button>
    </header>

    <section class="chat-messages" aria-live="polite">
      <p v-if="messages.length === 0" class="chat-empty">
        Задайте вопрос о проекте — например, «как работает таймер?» или «какие ADR приняты?»
      </p>
      <MessageItem v-for="message in messages" :key="message.id" :message="message" />
    </section>

    <p v-if="error !== ''" class="chat-error" role="alert">{{ error }}</p>

    <form class="chat-input" @submit.prevent="send">
      <input
        v-model="question"
        class="chat-question"
        type="text"
        aria-label="Вопрос"
        placeholder="Вопрос о проекте…"
        :disabled="busy"
      />
      <button class="chat-submit" type="submit" :disabled="busy">
        {{ busy ? 'Ждём ответ…' : 'Спросить' }}
      </button>
    </form>
  </main>
</template>
