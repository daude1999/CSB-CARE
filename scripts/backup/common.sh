# shellcheck shell=bash
# Shared shell helpers for scripts/backup/*.sh. Source it; do not run it.
# Never use `set -x` in these scripts: it would print secrets.

BACKUP_SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PG_IMAGE="${BACKUP_PG_IMAGE:-postgres:17-alpine}"
PG_TOOLS="${PG_TOOLS:-docker}"   # docker (default on the runner) or local (installed pg_dump/pg_restore/psql)
DOCKER_NETWORK="${BACKUP_DOCKER_NETWORK:-bridge}" # "host" only for local testing against a database on this machine
RUN_LABEL="csb-backup-${GITHUB_RUN_ID:-local}-$$"

die() { echo "::error::$*" >&2; exit 1; }

# A private working folder that is always removed, even when a step fails or the job is cancelled.
make_workdir() {
  umask 077
  WORK="${BACKUP_WORK_DIR:-$(mktemp -d)}"
  rm -rf "$WORK"
  mkdir -p "$WORK"
  chmod 700 "$WORK"
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
}

cleanup() {
  local status=$?
  if [[ "$PG_TOOLS" == docker ]] && command -v docker >/dev/null 2>&1; then
    docker ps -aq --filter "label=$RUN_LABEL" | xargs -r docker rm -f >/dev/null 2>&1 || true
  fi
  [[ -n "${WORK:-}" ]] && rm -rf "$WORK"
  if [[ -n "${WORK:-}" && -e "$WORK" ]]; then
    echo "::error::Could not remove the temporary backup folder. Remove it by hand on the runner." >&2
    status=1
  fi
  exit "$status"
}

require_tools() {
  local t
  for t in "$@"; do command -v "$t" >/dev/null 2>&1 || die "The runner is missing '$t'. See docs/BACKUPS.md, Runner requirements."; done
  if [[ "$PG_TOOLS" == docker ]]; then
    command -v docker >/dev/null 2>&1 || die "The runner is missing Docker. See docs/BACKUPS.md, Runner requirements."
  else
    for t in pg_dump pg_restore psql; do command -v "$t" >/dev/null 2>&1 || die "PG_TOOLS=local but '$t' is not installed"; done
  fi
}

# load_pg_env VAR [--direct|--restore-target]: exports PGHOST/PGUSER/PGPASSWORD/... from the URL in $VAR.
load_pg_env() {
  unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE PGCHANNELBINDING PGOPTIONS
  local kvs=() kv
  mapfile -d '' kvs < <(node "$BACKUP_SCRIPTS/pg-env.mjs" "$@")
  ((${#kvs[@]})) || exit 1
  # shellcheck disable=SC2163 # each entry is NAME=value
  for kv in "${kvs[@]}"; do export "$kv"; done
}

# pgtool <pg_dump|pg_restore|psql> args...: runs a PostgreSQL client with the PG* variables.
# Passwords travel as environment variables, never as command-line arguments.
pgtool() {
  if [[ "$PG_TOOLS" == local ]]; then
    "$@"
  else
    docker run --rm --network "$DOCKER_NETWORK" --label "$RUN_LABEL" --user "$(id -u):$(id -g)" \
      -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGCHANNELBINDING -e PGOPTIONS \
      -e HOME=/tmp -v "$WORK:$WORK" -w "$WORK" "$PG_IMAGE" "$@"
  fi
}

# pgtool_offline <pg_restore --list ...>: no database connection needed.
pgtool_offline() {
  if [[ "$PG_TOOLS" == local ]]; then
    "$@"
  else
    docker run --rm --network none --label "$RUN_LABEL" --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$WORK:$WORK" -w "$WORK" "$PG_IMAGE" "$@"
  fi
}

summary() { [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo "$*" >> "$GITHUB_STEP_SUMMARY"; echo "$*"; }
