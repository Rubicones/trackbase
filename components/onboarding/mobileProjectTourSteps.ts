import type { TourStep } from '@/components/onboarding/ProjectTour'

export function buildMobileProjectTourSteps(getMode: () => 'rehearse' | 'mixer'): TourStep[] {
  return [
    {
      target: null,
      title: 'Welcome to {PROJECT_NAME}',
      body: 'Trackbase on your phone has two modes — Rehearsal for playing along, and Mixer for editing tracks. We\'ll start in Rehearsal.',
    },
    {
      target: 'mobile-mode-switch',
      title: 'Rehearsal & Mixer',
      body: 'Rehearsal is for practice — big sections, lyrics, and transport controls. Mixer is where you upload tracks, record, and leave comments.',
    },
    {
      target: 'mobile-rehearse-sections',
      title: 'Jump to any section',
      body: 'Tap a section to seek there instantly. Loop a section from the transport bar when you want to drill a part.',
    },
    {
      target: 'mobile-rehearse-transport',
      title: 'Play along',
      body: 'Use play/pause, metronome, count-in, and section loop while you rehearse. The waveform shows your full mix.',
    },
    {
      target: 'mobile-mode-switch',
      title: 'Switch to Mixer',
      body: 'Tap the Mixer tab above to continue — the tour picks up there with tracks, recording, comments, and chat.',
      gate: () => getMode() === 'mixer',
      gateHint: 'Switch to Mixer',
    },
    {
      target: 'mobile-mixer-version-bar',
      title: 'Versions & branches',
      body: 'Switch between main and branches, create a new branch, or toggle comment mode on a waveform.',
    },
    {
      target: 'mobile-mixer-tracks',
      title: 'Track list',
      body: 'Each row is a track with mute/solo, waveform, and per-track actions. Swipe the section pills to jump around the song.',
    },
    {
      target: 'mobile-mixer-add-track',
      title: 'Add material',
      body: 'Upload WAV, MP3, or MIDI — or add a loop. Each file becomes its own track in the project.',
    },
    {
      target: 'mobile-mixer-recording',
      title: 'Record a take',
      body: 'Tap Record track to add a live recording row. Arm it, then use the red record button in the transport to capture audio from your mic.',
    },
    {
      target: 'mobile-mixer-record-transport',
      title: 'Recording transport',
      body: 'Tap once to arm, again to record, and again to stop. Count-in applies if you enabled it in Rehearsal or Mixer transport.',
    },
    {
      target: 'mobile-mixer-comments',
      title: 'Comments on the waveform',
      body: 'Turn on comment mode, then tap and drag on any waveform to mark a time range for the band — same as desktop.',
    },
    {
      target: 'mobile-chat',
      title: 'Band chat',
      body: 'Tap Chat above the mode switch to message the band, @mention teammates, and link branches or time ranges on a track — from rehearsal or mixer.',
    },
  ]
}
