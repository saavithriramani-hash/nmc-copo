#!/bin/sh
# Application entrypoint. Applies any pending database migrations, then
# starts the server. Running migrations here means the schema always
# matches the code that is about to run — nobody has to remember a
# separate migrate step.
set -e

echo "[startup] applying database migrations..."
# `migrate deploy` only applies already-created migrations; it never
# generates or edits one, so it is safe to run on every start.
node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma

echo "[startup] migrations up to date; starting the application."
exec "$@"
