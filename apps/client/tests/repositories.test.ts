import { beforeEach, describe, expect, it } from 'vitest'
import {
  db,
  type TrainingSession,
  type WorkoutTemplate,
} from '../src/db/db'
import { sessionsRepo, templatesRepo } from '../src/db/repositories'
import { DEFAULT_PROTOCOL } from '../src/domain/protocol'

async function seedTemplate(name: string, injection: Partial<WorkoutTemplate> = {}): Promise<WorkoutTemplate> {
  return await templatesRepo.create(name, {
    ...(injection.protocol ?? DEFAULT_PROTOCOL),
  })
}

function makeSession(init: Partial<TrainingSession>): TrainingSession {
  return {
    startedAt: init.startedAt ?? Date.now(),
    templateName: init.templateName ?? 'Табата 20/10 × 8 раундов',
    protocolSnapshot: init.protocolSnapshot ?? { ...DEFAULT_PROTOCOL },
    completedRounds: init.completedRounds ?? 0,
    status: init.status ?? 'completed',
    finishedAt: init.finishedAt,
    templateId: init.templateId,
  }
}

beforeEach(async () => {
  await db.sessions.clear()
  await db.templates.clear()
})

describe('templatesRepo', () => {
  it('create добавляет пользовательский шаблон (isPreset=false)', async () => {
    const created = await templatesRepo.create('Моя табата', { ...DEFAULT_PROTOCOL, workSec: 30 })
    expect(created.id).toBeGreaterThan(0)
    expect(created.name).toBe('Моя табата')
    expect(created.isPreset).toBe(false)
    expect(created.protocol.workSec).toBe(30)
  })

  it('list возвращает созданные шаблоны', async () => {
    await templatesRepo.create('А', DEFAULT_PROTOCOL)
    await templatesRepo.create('Б', { ...DEFAULT_PROTOCOL, rounds: 2 })
    const list = await templatesRepo.list()
    expect(list.map((t) => t.name)).toEqual(['А', 'Б'])
    expect(list.every((t) => t.isPreset === false)).toBe(true)
  })

  it('rename переименовывает и не трогает protocol', async () => {
    const t = await seedTemplate('Старое имя')
    await templatesRepo.rename(t.id!, 'Новое имя')
    const [after] = await templatesRepo.list()
    expect(after!.name).toBe('Новое имя')
    expect(after!.protocol).toEqual(DEFAULT_PROTOCOL)
    expect(after!.id).toBe(t.id)
  })

  it('remove удаляет только шаблон, сессии сохраняются (AC-7, FR-7)', async () => {
    const t = await seedTemplate('Будет удалён')
    await sessionsRepo.save(
      makeSession({ templateName: 'Будет удалён', templateId: t.id, status: 'completed' }),
    )
    await templatesRepo.remove(t.id!)
    expect(await templatesRepo.list()).toEqual([])
    const sessions = await sessionsRepo.recent(10)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.templateName).toBe('Будет удалён')
    expect(sessions[0]!.protocolSnapshot).toEqual(DEFAULT_PROTOCOL)
  })
})

describe('sessionsRepo', () => {
  it('save добавляет сессию completed', async () => {
    const record = makeSession({
      startedAt: 1_000,
      finishedAt: 2_000,
      completedRounds: 8,
      status: 'completed',
    })
    await sessionsRepo.save(record)
    const [recent] = await sessionsRepo.recent(10)
    expect(recent!.status).toBe('completed')
    expect(recent!.completedRounds).toBe(8)
    expect(recent!.templateName).toBe('Табата 20/10 × 8 раундов')
  })

  it('save добавляет сессию abandoned с completedRounds (AC-5)', async () => {
    await sessionsRepo.save(
      makeSession({ status: 'abandoned', completedRounds: 3, protocolSnapshot: { ...DEFAULT_PROTOCOL, rounds: 10 } }),
    )
    const [recent] = await sessionsRepo.recent(10)
    expect(recent!.status).toBe('abandoned')
    expect(recent!.completedRounds).toBe(3)
    expect(recent!.protocolSnapshot.rounds).toBe(10)
  })

  it('recent сортирует по дате (свежие первыми) и уважает limit', async () => {
    for (const startedAt of [9_000, 1_000, 5_000, 7_000]) {
      await sessionsRepo.save(makeSession({ startedAt }))
    }
    const recent = await sessionsRepo.recent(3)
    expect(recent.map((r) => r.startedAt)).toEqual([9_000, 7_000, 5_000])
  })

  it('save обновляет запись с тем же id (upsert)', async () => {
    const record: TrainingSession = { ...makeSession({ startedAt: 1_000, status: 'completed' }), id: 5 }
    await sessionsRepo.save(record)
    await sessionsRepo.save({ ...record, completedRounds: 16 })
    expect(await db.sessions.count()).toBe(1)
    const [updated] = await sessionsRepo.recent(10)
    expect(updated!.id).toBe(5)
    expect(updated!.completedRounds).toBe(16)
  })
})
