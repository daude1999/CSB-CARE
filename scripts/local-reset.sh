#!/usr/bin/env sh
# macOS / Linux: start the LOCAL database again. Same as `npm run db:reset:local`. Pass --clean for an empty database.
exec node scripts/local-reset.mjs "$@"
