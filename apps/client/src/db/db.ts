import Dexie, { type Table } from 'dexie'
import type { TabataProtocol } from '../domain/protocol'

export interface WorkoutTemplate {
  id?: number
  name: string
  protocol: TabataProtocol
  isPreset: boolean
}

export type SessionStatus = 'in_progress' | 'completed' | 'abandoned'

export interface TrainingSession {
  id?: number
  startedAt: number
  finishedAt?: number
  templateId?: number
  templateName: string
  protocolSnapshot: TabataProtocol
  completedRounds: number
  status: SessionStatus
}

class TrainingDatabase extends Dexie {
  templates!: Table<WorkoutTemplate, number>
  sessions!: Table<TrainingSession, number>

  constructor() {
    super('don-ti-training')
    this.version(1).stores({
      templates: '++id, name',
      sessions: '++id, startedAt',
    })
  }
}

export const db = new TrainingDatabase()
