# CO–PO Attainment application.
#
# Two stages: a builder that installs and compiles, and a small runtime
# image that carries only the compiled server. Nothing is installed at
# run time, so a deployment cannot fail because the college's network
# could not reach a package registry.

# ─────────────────────────── build stage ───────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# OpenSSL is required by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install with the lockfile first, so this layer is cached until a
# dependency actually changes.
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/export/package.json packages/export/
COPY packages/report/package.json packages/report/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .

# The Prisma client must be generated before the app is compiled.
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm run build -w @copo/web

# ────────────────────────── runtime stage ──────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    COPO_STORAGE_DIR=/app/storage \
    BACKUP_DIR=/backups

# Next's standalone output: the server plus exactly the modules it traced.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# Migrations are applied at start-up, so the schema always matches the
# code that is about to run. The CLI and schema are needed for that.
COPY --from=builder /app/packages/db/prisma ./prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

COPY ops/entrypoint-app.sh /usr/local/bin/entrypoint-app.sh
RUN chmod +x /usr/local/bin/entrypoint-app.sh \
    && mkdir -p /app/storage /backups \
    && chown -R node:node /app /backups

USER node
EXPOSE 3000

# A failing health check makes `docker compose ps` show the problem
# without anyone needing to read a log.
HEALTHCHECK --interval=60s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint-app.sh"]
CMD ["node", "apps/web/server.js"]
