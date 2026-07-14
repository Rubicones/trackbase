declare module 'ffprobe-static' {
  /** Absolute path to the bundled ffprobe binary for the current platform. */
  export const path: string
  const ffprobeStatic: { path: string }
  export default ffprobeStatic
}
