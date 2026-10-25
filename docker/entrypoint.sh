#!/bin/sh
set -e
case "$1" in
  web)
    if [ "${MIGRATE_ON_START:-false}" = "true" ]; then npx prisma migrate deploy; fi
    exec node .next/standalone/server.js ;;
  worker)
    exec npx tsx src/worker/index.ts ;;
  migrate)
    exec npx prisma migrate deploy ;;
  seed)
    exec npx tsx prisma/seed.ts ;;
  monitor-once)
    shift; exec npx tsx src/worker/run-once.ts "$@" ;;
  *)
    exec "$@" ;;
esac
