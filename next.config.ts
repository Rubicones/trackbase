import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/versions/[id]/tracks/process': ['./node_modules/ffmpeg-static/**'],
  },
  async redirects() {
    return [
      {
        source: '/favicon.ico',
        destination: '/icon.svg',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
