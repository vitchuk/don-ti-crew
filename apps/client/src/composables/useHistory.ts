import { ref } from 'vue'
import { sessionsRepo } from '../db/repositories'
import type { TrainingSession } from '../db/db'

const RECENT_LIMIT = 50

const sessions = ref<TrainingSession[]>([])

export function useHistory() {
  async function refresh(): Promise<void> {
    try {
      sessions.value = await sessionsRepo.recent(RECENT_LIMIT)
    } catch {
      sessions.value = []
    }
  }

  return {
    sessions,
    refresh,
  }
}
