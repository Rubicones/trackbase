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
    }
  ): Promise<Player>

  export default { instrument }
}
