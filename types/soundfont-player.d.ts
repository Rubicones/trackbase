declare module 'soundfont-player' {
  interface Player {
    play(note: string, time?: number, options?: {
      duration?: number
      gain?: number
    }): AudioScheduledSourceNode
    stop(): void
    disconnect(): void
  }

  function instrument(
    context: AudioContext,
    name: string,
    options?: {
      soundfont?: string
      nameToUrl?: (name: string, soundfont: string) => string
      /** Destination node to connect to (defaults to ctx.destination) */
      destination?: AudioNode
      /**
       * ADSR envelope applied to each note: [attack, decay, sustain, release] in seconds.
       * Release > 0 prevents abrupt note-off clicks by fading the gain smoothly.
       */
      adsr?: [number, number, number, number]
    }
  ): Promise<Player>

  export default { instrument }
}
