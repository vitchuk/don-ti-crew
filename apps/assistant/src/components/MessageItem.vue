<script setup lang="ts">
import type { ChatMessage } from '../types'

defineProps<{ message: ChatMessage }>()
</script>

<template>
  <article class="message" :class="message.role === 'user' ? 'message-user' : 'message-assistant'">
    <p class="message-text">{{ message.text }}</p>
    <ul
      v-if="message.citations !== undefined && message.citations.length > 0"
      class="message-citations"
      aria-label="Цитаты"
    >
      <li v-for="(citation, i) in message.citations" :key="i" class="message-citation">
        {{ citation.file }}
        <span v-if="citation.heading" class="message-citation-heading"> — {{ citation.heading }}</span>
      </li>
    </ul>
  </article>
</template>
