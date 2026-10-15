import { ref } from 'vue'
import type { WorkoutTemplate } from '../db/db'
import type { TabataProtocol } from '../domain/protocol'
import { templatesRepo } from '../db/repositories'
import { PRESETS } from '../presets/presets'

const templates = ref<WorkoutTemplate[]>([])
const loaded = ref(false)

export function useTemplates() {
  async function refresh(): Promise<void> {
    let custom: WorkoutTemplate[] = []
    try {
      custom = await templatesRepo.list()
    } catch {
      custom = []
    }
    templates.value = [...PRESETS, ...custom]
  }

  function ensureLoaded(): void {
    if (!loaded.value) {
      loaded.value = true
      void refresh()
    }
  }

  async function createTemplate(name: string, protocol: TabataProtocol): Promise<WorkoutTemplate> {
    const created = await templatesRepo.create(name, protocol)
    await refresh()
    return created
  }

  async function renameTemplate(id: number, name: string): Promise<void> {
    await templatesRepo.rename(id, name)
    await refresh()
  }

  async function removeTemplate(id: number): Promise<void> {
    await templatesRepo.remove(id)
    await refresh()
  }

  ensureLoaded()
  return {
    templates,
    refresh,
    createTemplate,
    renameTemplate,
    removeTemplate,
  }
}
