/**
 * Cached soundfont loading for MIDI track playback.
 * Instruments are preloaded when tracks appear so play() can schedule notes immediately.
 */
import { gmInstrumentName } from '@/lib/midi'
import type Soundfont from 'soundfont-player'

export type MidiSoundfontPlayer = Awaited<ReturnType<typeof Soundfont.instrument>>

export type MidiInstrumentMap = Map<number, MidiSoundfontPlayer>

let soundfontImport: Promise<typeof import('soundfont-player')> | null = null
// Keyed by the AudioContext instance so instruments created for one context are never
// reused with a different context (e.g. the PianoRollEditor's preview context vs the
// shared playback context — same sample rate, different instances).
const instrumentCacheByCtx = new WeakMap<BaseAudioContext, Map<number, Promise<MidiSoundfontPlayer>>>()

function getCtxCache(ctx: BaseAudioContext): Map<number, Promise<MidiSoundfontPlayer>> {
  let map = instrumentCacheByCtx.get(ctx)
  if (!map) {
    map = new Map()
    instrumentCacheByCtx.set(ctx, map)
  }
  return map
}

function loadSoundfontModule() {
  if (!soundfontImport) {
    soundfontImport = import('soundfont-player')
  }
  return soundfontImport
}

/** Start loading the soundfont-player module (no-op if already loading). */
export function warmMidiSoundfontModule(): void {
  void loadSoundfontModule()
}

/** Load (or return cached) instrument for a GM program number, bound to `ctx`. */
export function getMidiInstrument(ctx: BaseAudioContext, program: number): Promise<MidiSoundfontPlayer> {
  const ctxCache = getCtxCache(ctx)
  let pending = ctxCache.get(program)
  if (!pending) {
    pending = (async () => {
      const { default: SF } = await loadSoundfontModule()
      const name = gmInstrumentName(program)
      // adsr: [attack, decay, sustain, release] — 50 ms release prevents the abrupt
      // gain-to-zero click that occurs at note-off (both scheduled and forced via stop()).
      return SF.instrument(ctx as AudioContext, name, { soundfont: 'MusyngKite', adsr: [0, 0, 1, 0.05] })
    })()
    ctxCache.set(program, pending)
  }
  return pending
}

/** Fire-and-forget preload for a set of GM program numbers. */
export function preloadMidiInstruments(ctx: BaseAudioContext, programs: number[]): void {
  const unique = [...new Set(programs)]
  for (const program of unique) {
    getMidiInstrument(ctx, program).catch(() => {})
  }
}
