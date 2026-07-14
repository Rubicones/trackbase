import type { NextConfig } from 'next'
import { securityHeaders } from './lib/securityHeaders'

/** Force-include ffmpeg/ffprobe-static binaries in serverless traces (dynamic paths break default tracing). */
const ffmpegTracing = [
  './node_modules/ffmpeg-static/ffmpeg',
  './node_modules/ffmpeg-static/package.json',
  './node_modules/ffprobe-static/bin/**',
  './node_modules/ffprobe-static/package.json',
]

const ffmpegRoutes = [
  '/api/versions/[id]/tracks/process',
  '/api/versions/[id]/tracks/upload',
  '/api/versions/[id]/export',
  '/api/tracks/[id]/edit',
  '/api/tracks/[id]/download',
  '/api/projects/[id]/mix',
  '/api/projects/[id]/preview-mix',
  '/api/projects/[id]/preview-mix/recompute',
  '/api/tools/chord-detector',
] as const

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders(),
      },
    ]
  },
  // Legacy upload clients POST here; body { filename, fileSize } is handled by POST /resources.
  async rewrites() {
    return [
      {
        source: '/api/projects/:id/resources/presign',
        destination: '/api/projects/:id/resources',
      },
    ]
  },
  // Keep native/binary packages out of the webpack bundle so __dirname paths stay valid.
  // essentia.js ships a multi-MB Emscripten WASM bundle (server-side chord/key detection,
  // see lib/serverEssentia.ts) — external so webpack doesn't try to parse/minify it.
  serverExternalPackages: ['ffmpeg-static', 'ffprobe-static', 'fluent-ffmpeg', 'web-push', 'essentia.js'],
  outputFileTracingIncludes: Object.fromEntries(
    ffmpegRoutes.map(route => [route, ffmpegTracing]),
  ),
}

export default nextConfig
