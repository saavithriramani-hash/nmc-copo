import { createRequire } from 'node:module';
import path from 'node:path';
import type { NextConfig } from 'next';

const require = createRequire(import.meta.url);
const repoRoot = path.join(import.meta.dirname, '../../');

/**
 * pdfkit is reached only THROUGH the transpiled @copo/report package, and
 * Next's file tracing does not follow that hop reliably — so pdfkit and
 * its dependency closure are missing from the standalone output and PDF
 * generation would crash in the container.
 *
 * Rather than hand-maintain a list that would silently rot, we compute
 * the closure here at build time and force every module in it into the
 * trace. It follows new transitive dependencies automatically.
 */
function dependencyClosure(roots: string[]): string[] {
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    try {
      const pkgJson = require(`${name}/package.json`) as { dependencies?: Record<string, string> };
      for (const dep of Object.keys(pkgJson.dependencies ?? {})) visit(dep);
    } catch {
      /* a dependency not resolvable from here is skipped */
    }
  };
  for (const root of roots) visit(root);
  return [...seen];
}

// Globs in outputFileTracingIncludes are relative to the app directory,
// but the dependencies are hoisted to the monorepo root's node_modules.
const pdfClosure = dependencyClosure(['pdfkit']).map((name) => `../../node_modules/${name}/**`);

const nextConfig: NextConfig = {
  // Self-contained server bundle, so the runtime image needs no install
  // step and carries only what the application actually uses.
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  // Force pdfkit and everything it needs into the trace, for every server
  // entry (routes and the background job runner both render PDFs).
  outputFileTracingIncludes: {
    '/**': pdfClosure,
  },
  // Workspace packages ship TypeScript source; Next transpiles them.
  transpilePackages: ['@copo/engine', '@copo/db', '@copo/auth', '@copo/export', '@copo/report'],
  // Native/server-only modules stay external to the server bundle.
  serverExternalPackages: ['@prisma/client', '@node-rs/argon2', 'exceljs', 'pdfkit', 'archiver'],

  /**
   * pdfkit must NOT be bundled, and listing it above is not enough.
   *
   * It loads its standard-font metrics (`data/Helvetica.afm`) from a path
   * relative to its own module. Bundled, that module becomes
   * `.next/server/chunks/<hash>.js`, so it looks for the metrics beside
   * the chunk, does not find them, and every PDF route fails at the first
   * `new PDFDocument()` with ENOENT — in dev and in a production build
   * alike. The unit tests cannot catch it: vitest runs pdfkit unbundled
   * from node_modules, where its data directory is intact.
   *
   * `serverExternalPackages` does not cover this case because pdfkit is
   * reached THROUGH @copo/report, which is in `transpilePackages`; webpack
   * resolves and bundles it from inside the transpiled package regardless.
   * Declaring the external here applies to that hop too.
   *
   * Being external, pdfkit must exist in node_modules at runtime — which
   * is what `outputFileTracingIncludes` above already guarantees for the
   * standalone output.
   */
  webpack: (config, { isServer }) => {
    if (isServer) {
      const existing = Array.isArray(config.externals)
        ? config.externals
        : config.externals
          ? [config.externals]
          : [];
      config.externals = [...existing, { pdfkit: 'commonjs pdfkit' }];
    }
    return config;
  },
};

export default nextConfig;
