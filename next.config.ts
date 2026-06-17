import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/versions/[id]/tracks/process': ['./node_modules/ffmpeg-static/**'],
  },
};

export default nextConfig;
