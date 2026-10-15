import { describe, expect, it } from 'vitest'
import { DEFAULT_PROTOCOL, validateProtocol, type TabataProtocol } from '../src/domain/protocol'
import { PRESETS } from '../src/presets/presets'

const PROTO_FIELDS: (keyof TabataProtocol)[] = [
  'prepareSec',
  'workSec',
  'restSec',
  'rounds',
  'cycles',
  'restBetweenCyclesSec',
]

describe('DEFAULT_PROTOCOL', () => {
  it('соответствует FR-5', () => {
    expect(DEFAULT_PROTOCOL).toEqual({
      prepareSec: 10,
      workSec: 20,
      restSec: 10,
      rounds: 8,
      cycles: 1,
      restBetweenCyclesSec: 60,
    })
  })
})

describe('validateProtocol', () => {
  it('принимает значения по умолчанию', () => {
    expect(validateProtocol(DEFAULT_PROTOCOL)).toEqual([])
  })

  it('отвергает <= 0 во всех полях длительности и диапазонах', () => {
    for (const field of PROTO_FIELDS) {
      const broken: TabataProtocol = { ...DEFAULT_PROTOCOL, [field]: 0 }
      const errors = validateProtocol(broken)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.field).toBe(field)
    }
  })

  it('отвергает отрицательные значения', () => {
    for (const field of PROTO_FIELDS) {
      const broken: TabataProtocol = { ...DEFAULT_PROTOCOL, [field]: -5 }
      const errors = validateProtocol(broken)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.field).toBe(field)
    }
  })

  it('отвергает rounds = 31edged', () => {
    const errors = validateProtocol({ ...DEFAULT_PROTOCOL, rounds: 31 })
    expect(errors.map((e) => e.field)).toContain('rounds')
  })

  it('отвергает cycles = 11', () => {
    const errors = validateProtocol({ ...DEFAULT_PROTOCOL, cycles: 11 })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.field).toBe('cycles')
  })

  it('сообщает об ошибке на русском', () => {
    const errors = validateProtocol({ ...DEFAULT_PROTOCOL, restSec: 0 })
    expect(errors[0]!.message.length).toBeGreaterThan(0)
    expect(/[а-яё]/i.test(errors[0]!.message)).toBe(true)
  })

  it('допускает граничные значения', () => {
    expect(validateProtocol({ ...DEFAULT_PROTOCOL, rounds: 30, cycles: 10, workSec: 1 })).toEqual([])
    expect(validateProtocol({ ...DEFAULT_PROTOCOL, rounds: 1, cycles: 1, prepareSec: 1 })).toEqual([])
  })

  it('собирает несколько ошибок сразу', () => {
    const errors = validateProtocol({ ...DEFAULT_PROTOCOL, workSec: 0, cycles: 0 })
    expect(errors.map((e) => e.field).sort()).toEqual(['cycles', 'workSec'])
  })
})

describe('PRESETS', () => {
  it('содержит два пресета по FR-6', () => {
    expect(PRESETS).toHaveLength(2)
    expect(PRESETS.map((p) => p.name)).toEqual([
      'Табата 20/10 × 8 раундов',
      'Табата 20/10 × 8 раундов × 2 цикла',
    ])
    for (const p of PRESETS) expect(p.isPreset).toBe(true)
  })

  it('протоколы пресетов валидны', () => {
    for (const p of PRESETS) expect(validateProtocol(p.protocol)).toEqual([])
  })

  it('второй пресет имеет два цикла и отдых между циклами', () => {
    expect(PRESETS[1]!.protocol.cycles).toBe(2)
    expect(PRESETS[1]!.protocol.restBetweenCyclesSec).toBe(60)
  })
})
