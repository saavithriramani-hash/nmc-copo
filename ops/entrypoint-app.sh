#!/bin/sh
# Application entrypoint. Applies any pending database migrations, then
# starts the server. Running migrations here means the schema always
# matches the code that is about to run — nobody has to remember a
# separate migrate step.
set -e

echo "[startup] applying database migrations..."
# `migrate deploy` only applies already-created migrations; it never
# generates or edits one, so it is safe to run on every start.
#
# The CLI lives in its own tree (see the Dockerfile), invoked at its real
# path. Not through node_modules/.bin/prisma: that entry is a symlink, and
# COPY dereferences symlinks, so the copied file landed in .bin/ without
# the .wasm files it loads from its own directory.
node /app/prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma

echo "[startup] migrations up to date; starting the application."
exec "$@"
