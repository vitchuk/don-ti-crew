import { db, type TrainingSession, type WorkoutTemplate } from './db'
import type { TabataProtocol } from '../domain/protocol'

export const templatesRepo = {
  async list(): Promise<WorkoutTemplate[]> {
    return await db.templates.orderBy('id').toArray()
  },
  async create(name: string, protocol: TabataProtocol): Promise<WorkoutTemplate> {
    const template: WorkoutTemplate = { name, protocol, isPreset: false }
    const id = await db.templates.add(template)
    return { ...template, id }
  },
  async rename(id: number, name: string): Promise<void> {
    await db.templates.update(id, { name })
  },
  async remove(id: number): Promise<void> {
    await db.templates.delete(id)
  },
}

export const sessionsRepo = {
  async save(s: TrainingSession): Promise<void> {
    if (s.id === undefined) {
      await db.sessions.add(s)
    } else {
      await db.sessions.put(s)
    }
  },
  async recent(limit: number): Promise<TrainingSession[]> {
    return await db.sessions.orderBy('startedAt').reverse().limit(limit).toArray()
  },
}
