#!/bin/sh
# ─────────────────────────────────────────────────────────────
# Applies pending database migrations, then hands off to the CMD.
# `migrate deploy` is idempotent and safe to run on every boot; it
# never generates new migrations and never resets data.
# ─────────────────────────────────────────────────────────────
set -e

if [ "${RUN_MIGRATIONS_ON_BOOT:-true}" = "true" ]; then
  echo "[entrypoint] applying database migrations..."
  npx prisma migrate deploy
  echo "[entrypoint] migrations applied."
fi

echo "[entrypoint] starting: $*"
exec "$@"
