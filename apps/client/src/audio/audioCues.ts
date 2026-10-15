import type { BeepType } from '../domain/beepPlan'

let audioContext: AudioContext | null = null

export function getAudioContext(): AudioContext | null {
  if (audioContext !== null) {
    if (audioContext.state === 'suspended') void audioContext.resume()
    return audioContext
  }
  try {
    audioContext = new AudioContext()
  } catch {
    audioContext = null
    return null
  }
  return audioContext
}

interface BeepSpec {
  frequency: number
  durationMs: number
  gapMs: number
  repeats: number
}

const BEEP_SPECS: Record<BeepType, BeepSpec> = {
  tickLow: { frequency: 550, durationMs: 110, gapMs: 0, repeats: 1 },
  phaseSwitchHigh: { frequency: 1040, durationMs: 160, gapMs: 0, repeats: 1 },
  restStart: { frequency: 760, durationMs: 140, gapMs: 90, repeats: 2 },
  sessionFinish: { frequency: 1040, durationMs: 190, gapMs: 130, repeats: 3 },
}

export function beep(ctx: AudioContext | null, type: BeepType): void {
  if (ctx === null) return
  const spec = BEEP_SPECS[type]
  let start = ctx.currentTime + 0.01
  for (let i = 0; i < spec.repeats; i += 1) {
    const end = start + spec.durationMs / 1000
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(spec.frequency, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(start)
    osc.stop(end + 0.01)
    start = end + spec.gapMs / 1000
  }
}
