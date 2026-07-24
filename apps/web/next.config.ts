import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next transpiles them.
  transpilePackages: ['@copo/engine', '@copo/db', '@copo/auth'],
  // Native/server-only modules stay external to the server bundle.
  serverExternalPackages: ['@prisma/client', '@node-rs/argon2', 'exceljs'],
};

export default nextConfig;
