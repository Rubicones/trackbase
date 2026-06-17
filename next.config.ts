import type { NextConfig } from 'next'

/** Force-include ffmpeg-static binary in serverless traces (dynamic path breaks default tracing). */
const ffmpegTracing = [
  './node_modules/ffmpeg-static/ffmpeg',
  './node_modules/ffmpeg-static/package.json',
]

const ffmpegRoutes = [
  '/api/versions/[id]/tracks/process',
  '/api/versions/[id]/tracks/upload',
  '/api/versions/[id]/export',
  '/api/tracks/[id]/download',
  '/api/projects/[id]/mix',
  '/api/projects/[id]/preview-mix',
  '/api/projects/[id]/preview-mix/recompute',
] as const

const nextConfig: NextConfig = {
  // Keep native/binary packages out of the webpack bundle so __dirname paths stay valid.
  serverExternalPackages: ['ffmpeg-static', 'fluent-ffmpeg'],
  outputFileTracingIncludes: Object.fromEntries(
    ffmpegRoutes.map(route => [route, ffmpegTracing]),
  ),
}

export default nextConfig
