export interface TabataProtocol {
  prepareSec: number
  workSec: number
  restSec: number
  rounds: number
  cycles: number
  restBetweenCyclesSec: number
}

export interface ValidationError {
  field: keyof TabataProtocol
  message: string
}

export const DEFAULT_PROTOCOL: TabataProtocol = {
  prepareSec: 10,
  workSec: 20,
  restSec: 10,
  rounds: 8,
  cycles: 1,
  restBetweenCyclesSec: 60,
}

interface SecondRule {
  field: keyof TabataProtocol
  message: string
}

interface RangeRule {
  field: keyof TabataProtocol
  message: string
  min: number
  max: number
}

const SECOND_RULES: SecondRule[] = [
  { field: 'prepareSec', message: 'Подготовка: введите целое число секунд больше 0' },
  { field: 'workSec', message: 'Работа: введите целое число секунд больше 0' },
  { field: 'restSec', message: 'Отдых: введите целое число секунд больше 0' },
  { field: 'restBetweenCyclesSec', message: 'Отдых между циклами: введите целое число секунд больше 0' },
]

const RANGE_RULES: RangeRule[] = [
  { field: 'rounds', message: 'Раунды: введите целое число от 1 до 30', min: 1, max: 30 },
  { field: 'cycles', message: 'Циклы: введите целое число от 1 до 10', min: 1, max: 10 },
]

export function validateProtocol(p: TabataProtocol): ValidationError[] {
  const errors: ValidationError[] = []
  for (const rule of SECOND_RULES) {
    if (!Number.isInteger(p[rule.field]) || p[rule.field] <= 0) {
      errors.push({ field: rule.field, message: rule.message })
    }
  }
  for (const rule of RANGE_RULES) {
    if (!Number.isInteger(p[rule.field]) || p[rule.field] < rule.min || p[rule.field] > rule.max) {
      errors.push({ field: rule.field, message: rule.message })
    }
  }
  return errors
}
