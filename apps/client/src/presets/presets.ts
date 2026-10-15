import type { WorkoutTemplate } from '../db/db'
import { DEFAULT_PROTOCOL } from '../domain/protocol'

export const PRESETS: WorkoutTemplate[] = [
  {
    name: 'Табата 20/10 × 8 раундов',
    protocol: { ...DEFAULT_PROTOCOL },
    isPreset: true,
  },
  {
    name: 'Табата 20/10 × 8 раундов × 2 цикла',
    protocol: { ...DEFAULT_PROTOCOL, cycles: 2 },
    isPreset: true,
  },
]
