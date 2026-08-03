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

# ─────────────────────── prisma CLI stage ──────────────────────────
# The migration CLI, with its dependency tree resolved BY NPM rather than
# listed by hand.
#
# The runtime image previously copied node_modules/prisma and
# node_modules/@prisma and hoped that was enough. It was not: the CLI also
# needs effect, empathic, fast-check and whatever those pull in, and each
# omission surfaced only as a crash-looping container at start-up. The
# version is read from the repository's own lockfile, so this can never
# drift from the Prisma the application was built against.
FROM node:22-bookworm-slim AS prismacli
WORKDIR /cli
COPY package-lock.json ./
RUN PRISMA_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version")" \
    && echo "installing prisma@${PRISMA_VERSION} (from the lockfile)" \
    && npm init -y > /dev/null \
    && npm install --omit=optional --no-audit --no-fund "prisma@${PRISMA_VERSION}" \
    && node node_modules/prisma/build/index.js --version

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
# `apps/web/public` must exist in the repository even while it is empty —
# it is kept by a .gitkeep. Docker's COPY fails the whole build when its
# source is missing, so an absent directory here stopped the image being
# built at all, on any machine.
COPY --from=builder /app/apps/web/public ./apps/web/public

# Migrations are applied at start-up, so the schema always matches the
# code that is about to run. The CLI and schema are needed for that.
#
# The `node_modules/prisma` package carries the CLI at build/index.js
# together with the .wasm files it loads from its OWN directory. There is
# deliberately no copy of `node_modules/.bin/prisma` here: that is a
# symlink to build/index.js, and COPY dereferences symlinks — so copying
# it wrote the CLI's bytes into .bin/ where its .wasm siblings do not
# exist, and every start-up died on a missing prisma_schema_build_bg.wasm.
# The entrypoint calls build/index.js directly instead.
COPY --from=builder /app/packages/db/prisma ./prisma
# The query engine the APPLICATION uses at run time (@prisma/client).
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# The CLI, complete, in its own tree. Kept out of ./node_modules so it can
# never overwrite a package the traced application build depends on.
COPY --from=prismacli /cli/node_modules ./prisma-cli/node_modules

# Prove the CLI can actually start, here, while building.
#
# Without this, a Prisma upgrade that changed the dependency tree would
# surface as a crash-looping container on the college server. With it, the
# image simply refuses to build on the machine of whoever made the change.
RUN node ./prisma-cli/node_modules/prisma/build/index.js --version

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
