import { PrismaClient } from '@prisma/client';

/**
 * Loads .env into process.env when present (Node ≥ 20.12 built-in; no
 * dependency). Call from scripts run directly with tsx — the Prisma CLI
 * loads .env itself for migrate/seed.
 */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file — fine when DATABASE_URL is set in the environment.
  }
}

/** One PrismaClient per process; the app layer owns its lifecycle. */
export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}
