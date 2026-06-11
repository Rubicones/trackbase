/**
 * MIDI utilities — parse, serialize, and play MIDI via @tonejs/midi + soundfont-player.
 * All MIDI editing works through the MidiTrackData representation.
 * Never manipulate raw MIDI bytes directly.
 */
import { Midi } from '@tonejs/midi'
import type { MidiNote, MidiTrackData } from '@/lib/types'

// ─── Tick / sixteenth helpers ─────────────────────────────────────────────────

export function ticksToSixteenths(ticks: number, ppq: number): number {
  return (ticks / ppq) * 4
}

export function sixteenthsToTicks(sixteenths: number, ppq: number): number {
  return (sixteenths / 4) * ppq
}

export function sixteenthsPerBar(numerator: number, denominator: number): number {
  return (4 / denominator) * numerator * 4
}

/** Duration in seconds of one sixteenth note at a given BPM. */
export function sixteenthDuration(bpm: number): number {
  return (60 / bpm) / 4
}

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parseMidiFile(buffer: ArrayBuffer): MidiTrackData {
  const midi = new Midi(buffer)
  const track = midi.tracks[0] // MVP: first track only
  const ppq = midi.header.ppq

  const notes: MidiNote[] = track.notes.map((note, i) => ({
    id: `note_${i}`,
    pitch: note.midi,
    startSixteenth: ticksToSixteenths(note.ticks, ppq),
    durationSixteenths: Math.max(1, ticksToSixteenths(note.durationTicks, ppq)),
    velocity: Math.round(note.velocity * 127),
  }))

  const timeSig = midi.header.timeSignatures[0]?.timeSignature
  const totalSixteenths = ticksToSixteenths(midi.durationTicks, ppq)

  return {
    notes,
    name: track.name || '',
    instrument: track.instrument.number,
    totalSixteenths: Math.max(totalSixteenths, 64), // at least 4 bars
    bpm: midi.header.tempos[0]?.bpm ?? 120,
    timeSignatureNumerator: timeSig?.[0] ?? 4,
    timeSignatureDenominator: timeSig?.[1] ?? 4,
  }
}

// ─── Serialize ────────────────────────────────────────────────────────────────

export function serializeMidi(data: MidiTrackData): ArrayBuffer {
  const midi = new Midi()
  midi.header.setTempo(data.bpm)
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: [data.timeSignatureNumerator, data.timeSignatureDenominator],
  })

  const track = midi.addTrack()
  track.name = data.name

  data.notes.forEach(note => {
    track.addNote({
      midi: note.pitch,
      ticks: sixteenthsToTicks(note.startSixteenth, midi.header.ppq),
      durationTicks: sixteenthsToTicks(note.durationSixteenths, midi.header.ppq),
      velocity: note.velocity / 127,
    })
  })

  return midi.toArray().buffer as ArrayBuffer
}

// ─── Duration ─────────────────────────────────────────────────────────────────

/** Total duration in milliseconds of a MidiTrackData. */
/**
 * Duration of a MIDI track in milliseconds, based on the last note's end position.
 * Uses note content rather than totalSixteenths to avoid counting trailing blank bars
 * that some DAWs export beyond the last note.
 */
export function midiDurationMs(data: MidiTrackData): number {
  const sixMs = sixteenthDuration(data.bpm) * 1000
  if (data.notes?.length) {
    const lastEndSixteenth = Math.max(...data.notes.map(n => n.startSixteenth + n.durationSixteenths))
    return Math.ceil(lastEndSixteenth * sixMs)
  }
  // No notes: fall back to totalSixteenths (e.g. empty MIDI file)
  return data.totalSixteenths * sixMs
}

// ─── GM Instrument names ──────────────────────────────────────────────────────

export const GM_INSTRUMENTS: Record<number, string> = {
  0: 'acoustic_grand_piano',
  1: 'bright_acoustic_piano',
  2: 'electric_grand_piano',
  3: 'honkytonk_piano',
  4: 'electric_piano_1',
  5: 'electric_piano_2',
  6: 'harpsichord',
  7: 'clavinet',
  8: 'celesta',
  9: 'glockenspiel',
  11: 'vibraphone',
  12: 'marimba',
  13: 'xylophone',
  24: 'acoustic_guitar_nylon',
  25: 'acoustic_guitar_steel',
  26: 'electric_guitar_jazz',
  27: 'electric_guitar_clean',
  29: 'electric_guitar_muted',
  30: 'overdriven_guitar',
  31: 'distortion_guitar',
  32: 'acoustic_bass',
  33: 'electric_bass_finger',
  34: 'electric_bass_pick',
  35: 'fretless_bass',
  40: 'violin',
  41: 'viola',
  42: 'cello',
  48: 'string_ensemble_1',
  56: 'trumpet',
  57: 'trombone',
  58: 'tuba',
  60: 'french_horn',
  65: 'alto_sax',
  66: 'tenor_sax',
  73: 'flute',
  71: 'clarinet',
  80: 'lead_1_square',
  81: 'lead_2_sawtooth',
  89: 'pad_2_warm',
  91: 'pad_4_choir',
}

export function gmInstrumentName(program: number): string {
  return GM_INSTRUMENTS[program] ?? 'acoustic_grand_piano'
}

/** Human-readable GM family + instrument label for program number */
export const GM_PROGRAM_GROUPS: Array<{ family: string; programs: Array<{ num: number; label: string }> }> = [
  {
    family: 'Piano',
    programs: [
      { num: 0, label: 'Acoustic Grand' },
      { num: 1, label: 'Bright Acoustic' },
      { num: 2, label: 'Electric Grand' },
      { num: 3, label: 'Honky-tonk' },
    ],
  },
  {
    family: 'Guitar',
    programs: [
      { num: 24, label: 'Nylon Guitar' },
      { num: 25, label: 'Steel Guitar' },
      { num: 26, label: 'Jazz Guitar' },
      { num: 27, label: 'Clean Guitar' },
      { num: 30, label: 'Overdriven Guitar' },
      { num: 31, label: 'Distortion Guitar' },
    ],
  },
  {
    family: 'Bass',
    programs: [
      { num: 32, label: 'Acoustic Bass' },
      { num: 33, label: 'Finger Bass' },
      { num: 34, label: 'Pick Bass' },
      { num: 35, label: 'Fretless Bass' },
    ],
  },
  {
    family: 'Strings',
    programs: [
      { num: 40, label: 'Violin' },
      { num: 41, label: 'Viola' },
      { num: 42, label: 'Cello' },
      { num: 48, label: 'String Ensemble' },
    ],
  },
  {
    family: 'Brass',
    programs: [
      { num: 56, label: 'Trumpet' },
      { num: 57, label: 'Trombone' },
      { num: 58, label: 'Tuba' },
      { num: 60, label: 'French Horn' },
    ],
  },
  {
    family: 'Woodwind',
    programs: [
      { num: 65, label: 'Alto Sax' },
      { num: 66, label: 'Tenor Sax' },
      { num: 73, label: 'Flute' },
      { num: 71, label: 'Clarinet' },
    ],
  },
  {
    family: 'Chromatic Perc',
    programs: [
      { num: 11, label: 'Vibraphone' },
      { num: 12, label: 'Marimba' },
      { num: 13, label: 'Xylophone' },
    ],
  },
  {
    family: 'Synth',
    programs: [
      { num: 80, label: 'Lead Square' },
      { num: 81, label: 'Lead Sawtooth' },
      { num: 89, label: 'Pad Warm' },
      { num: 91, label: 'Pad Choir' },
    ],
  },
]

/** Get a human-readable label from a GM program number */
export function gmProgramLabel(num: number): string {
  for (const group of GM_PROGRAM_GROUPS) {
    const p = group.programs.find(p => p.num === num)
    if (p) return p.label
  }
  return `Program ${num}`
}
