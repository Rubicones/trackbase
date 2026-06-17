/** Global hook for stopping in-flight playback when the route changes or a player unmounts. */

let activeStop: (() => void) | null = null

export function registerPlaybackStop(stop: () => void): () => void {
  activeStop = stop
  return () => {
    if (activeStop === stop) activeStop = null
  }
}

export function stopAllPlayback() {
  activeStop?.()
}
