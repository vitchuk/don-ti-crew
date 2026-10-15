// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { askQuestionMock, fetchHealthMock } = vi.hoisted(() => ({
  askQuestionMock: vi.fn(),
  fetchHealthMock: vi.fn(async () => null),
}))

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api')>()
  return {
    ...actual,
    askQuestion: askQuestionMock,
    fetchHealth: fetchHealthMock,
  }
})

import App from '../src/App.vue'
import type { AskAnswer } from '../src/types'

const ANSWER: AskAnswer = {
  answer: 'Таймер — фазы, раунды, циклы по протоколу Табаты.',
  citations: [{ file: 'specs/001-tabata-timer/spec.md', heading: 'Таймер' }],
  context: { branch: 'main', clean: true, changedFilesCount: 0 },
}

beforeEach(() => {
  localStorage.clear()
  askQuestionMock.mockReset()
  fetchHealthMock.mockReset()
  fetchHealthMock.mockResolvedValue(null)
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) {
    wrapper.unmount()
  }
})

const wrappers: { unmount(): void }[] = []

async function mountApp() {
  vi.stubGlobal('crypto', globalThis.crypto)
  const wrapper = mount(App)
  await flushPromises()
  wrappers.push(wrapper)
  return wrapper
}

describe('App.vue — одностраничный чат (T-9/T-10/T-11)', () => {
  it('отправка вопроса рендерит пару user/assistant с цитатами', async () => {
    askQuestionMock.mockResolvedValue(ANSWER)
    const wrapper = await mountApp()

    await wrapper.get('input.chat-question').setValue('как работает таймер?')
    await wrapper.get('form.chat-input').trigger('submit')
    await flushPromises()

    const messages = wrapper.findAll('.message')
    expect(messages).toHaveLength(2)
    expect(messages[0]?.classes()).toContain('message-user')
    expect(messages[0]?.text()).toContain('как работает таймер?')
    expect(messages[1]?.classes()).toContain('message-assistant')
    expect(messages[1]?.text()).toContain('Таймер — фазы, раунды, циклы')
    expect(messages[1]?.findAll('.message-citation')[0]?.text()).toContain('specs/001-tabata-timer/spec.md')
    expect(wrapper.find('.chat-branch').text()).toContain('main')
    expect(localStorage.getItem('assistant.chat.v1')).not.toBeNull()
    expect(askQuestionMock).toHaveBeenCalledWith('как работает таймер?')
  })

  it('пустой вопрос не отправляет запрос и показывает одну фразу-подсказку', async () => {
    const wrapper = await mountApp()
    await wrapper.get('input.chat-question').setValue('   ')
    await wrapper.get('form.chat-input').trigger('submit')
    await flushPromises()
    expect(askQuestionMock).not.toHaveBeenCalled()
    expect(wrapper.find('.chat-error').text()).toContain('пустой')
  })

  it('ошибка backend → одна русская фраза с инструкцией, история работает', async () => {
    askQuestionMock.mockRejectedValue(new Error('Индекс знаний не построен — запустите `pnpm rag:index`.'))
    const wrapper = await mountApp()
    await wrapper.get('input.chat-question').setValue('q')
    await wrapper.get('form.chat-input').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.chat-error').text()).toContain('pnpm rag:index')
    // история сохранена
    expect(localStorage.getItem('assistant.chat.v1')).not.toBeNull()
  })

  it('кнопка «новый вопрос» очищает чат и localStorage; после перезагрузки чат пуст (AC-9)', async () => {
    askQuestionMock.mockResolvedValue(ANSWER)
    const first = await mountApp()
    await first.get('input.chat-question').setValue('q1')
    await first.get('form.chat-input').trigger('submit')
    await flushPromises()
    await first.get('button.chat-reset').trigger('click')
    expect(first.findAll('.message')).toHaveLength(0)
    expect(localStorage.getItem('assistant.chat.v1')).toBeNull()
    await first.unmount()

    const reopened = await mountApp()
    expect(reopened.findAll('.message')).toHaveLength(0)
    expect(reopened.text()).toContain('Задайте вопрос о проекте')
    await reopened.unmount()
  })

  it('история восстанавливается при перезагрузке страницы (FR-8)', async () => {
    askQuestionMock.mockResolvedValue(ANSWER)
    const first = await mountApp()
    await first.get('input.chat-question').setValue('q')
    await first.get('form.chat-input').trigger('submit')
    await flushPromises()
    await first.unmount()

    const reopened = await mountApp()
    expect(reopened.findAll('.message')).toHaveLength(2)
    expect(reopened.text()).toContain('Таймер — фазы, раунды, циклы')
    await reopened.unmount()
  })
})
