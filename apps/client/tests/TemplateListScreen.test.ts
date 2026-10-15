import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { beepMock } = vi.hoisted(() => ({ beepMock: vi.fn() }))

vi.mock('../src/audio/audioCues', () => ({
  getAudioContext: () => null,
  beep: beepMock,
}))

import TemplateListScreen from '../src/components/TemplateListScreen.vue'
import { db, type WorkoutTemplate } from '../src/db/db'
import { templatesRepo } from '../src/db/repositories'
import { useTemplates } from '../src/composables/useTemplates'
import { DEFAULT_PROTOCOL } from '../src/domain/protocol'

const brokenTemplate: WorkoutTemplate = {
  id: undefined,
  name: 'Шаблон без id',
  protocol: { ...DEFAULT_PROTOCOL },
  isPreset: false,
}

describe('TemplateListScreen', () => {
  beforeEach(async () => {
    await db.templates.clear()
  })

  afterEach(async () => {
    await db.templates.clear()
  })

  it('кнопка «Удалить» доступна для шаблона с id и реально удаляет (L3)', async () => {
    const created = await templatesRepo.create('С id', { ...DEFAULT_PROTOCOL })
    const { refresh } = useTemplates()
    const wrapper = mount(TemplateListScreen)
    await refresh()
    await flushPromises()
    const cards = wrapper.findAll('.template-card')
    expect(cards).toHaveLength(3)
    const ownCard = cards.find((c) => c.text().includes('С id'))!
    expect(ownCard.find('.template-actions').exists()).toBe(true)
    const deleteButton = ownCard
      .findAll('button')
      .find((b) => b.text() === 'Удалить')
    expect(deleteButton).toBeDefined()
    await deleteButton!.trigger('click')
    await flushPromises()
    await vi.waitFor(async () => expect(await db.templates.count()).toBe(0))
    expect(created.id).toBeGreaterThan(0)
    await wrapper.unmount()
  })

  it('кнопка «Удалить» отсутствует, когда у шаблона нет id; у пресетов нет действий (L3)', async () => {
    await templatesRepo.create('С id', { ...DEFAULT_PROTOCOL })
    const { templates, refresh } = useTemplates()
    const wrapper = mount(TemplateListScreen)
    await refresh()
    await flushPromises()
    templates.value = [...templates.value, brokenTemplate]
    await flushPromises()
    const cards = wrapper.findAll('.template-card')
    expect(cards).toHaveLength(4)
    const ownCard = cards.find((c) => c.text().includes('С id'))!
    const brokenCard = cards.find((c) => c.text().includes('Шаблон без id'))!
    const presetCard = cards.find((c) => c.text().includes('Табата 20/10'))!
    expect(ownCard.findAll('button').map((b) => b.text())).toContain('Удалить')
    expect(brokenCard.findAll('button').map((b) => b.text())).not.toContain('Удалить')
    expect(presetCard.findAll('button').map((b) => b.text())).not.toContain('Удалить')
    await wrapper.unmount()
  })

  it('подытог карточки показывает протокол: работа/отдых, раунды, циклы при > 1', async () => {
    await templatesRepo.create('Два цикла', { ...DEFAULT_PROTOCOL, cycles: 2 })
    const wrapper = mount(TemplateListScreen)
    await flushPromises()
    const card = wrapper.findAll('.template-card').find((c) => c.text().includes('Два цикла'))!
    expect(card.text()).toContain('20/10 с')
    expect(card.text()).toContain('раундов: 8')
    expect(card.text()).toContain('циклов: 2')
    await wrapper.unmount()
  })
})
