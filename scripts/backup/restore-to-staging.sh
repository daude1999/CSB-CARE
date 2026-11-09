#!/usr/bin/env bash
# Restores an encrypted backup into a SEPARATE staging/restore-check database and verifies it.
# It never restores over production: the target is refused when it shares a host or Neon endpoint
# with PRODUCTION_DATABASE_HOSTS, or when its database name lacks "restore" or "staging".
#
# Env:
#   RESTORE_TARGET_DATABASE_URL     the staging database to restore into
#   PRODUCTION_DATABASE_HOSTS       production database hostnames (comma or space separated)
#   BACKUP_AGE_IDENTITY             the age private key (AGE-SECRET-KEY-1...) used to decrypt
#   AZURE_RESTORE_CONTAINER_SAS_URL container SAS with read + list only
#   RESTORE_BLOB                    optional blob name; the newest backup when empty
#   RESTORE_FROM_FILE               optional local .age file instead of downloading (manual use)
#
# The target must be empty, or a database this script restored before (it carries the
# csb_restore_check marker schema). Only then is its public schema replaced.
set -euo pipefail
# shellcheck source=scripts/backup/common.sh
source "$(dirname "$0")/common.sh"

: "${RESTORE_TARGET_DATABASE_URL:?Set RESTORE_TARGET_DATABASE_URL to the separate staging database}"
: "${BACKUP_AGE_IDENTITY:?Set BACKUP_AGE_IDENTITY to the age private key}"

require_tools node age
make_workdir
started=$(date +%s)

# 1. Guard the target first, before anything is downloaded or decrypted.
load_pg_env RESTORE_TARGET_DATABASE_URL --restore-target
echo "Restore target passed the production guard (database: $PGDATABASE)."

q() { pgtool psql -X -v ON_ERROR_STOP=1 -At -c "$1"; }

public_tables=$(q "select count(*) from information_schema.tables where table_schema = 'public'")
has_marker=$(q "select count(*) from information_schema.tables where table_schema = 'csb_restore_check' and table_name = 'marker'")
if [[ "$public_tables" != 0 && "$has_marker" != 1 ]]; then
  die "Refusing to restore: the target database already has tables and was not created by a previous restore check. Use an empty database"
fi

# 2. Fetch and decrypt into the private folder.
encrypted="$WORK/backup.dump.age"
if [[ -n "${RESTORE_FROM_FILE:-}" ]]; then
  cp "$RESTORE_FROM_FILE" "$encrypted"
  blob="${RESTORE_BLOB:-$(basename "$RESTORE_FROM_FILE")}"
else
  : "${AZURE_RESTORE_CONTAINER_SAS_URL:?Add the read/list container SAS as AZURE_RESTORE_CONTAINER_SAS_URL}"
  blob="${RESTORE_BLOB:-$(node "$BACKUP_SCRIPTS/blob.mjs" latest)}"
  node "$BACKUP_SCRIPTS/blob.mjs" download "$blob" "$encrypted"
fi
identity="$WORK/identity.txt"
printf '%s\n' "$BACKUP_AGE_IDENTITY" > "$identity"
dump="$WORK/backup.dump"
age --decrypt --identity "$identity" --output "$dump" "$encrypted" || die "Could not decrypt the backup with BACKUP_AGE_IDENTITY"
rm -f "$identity" "$encrypted"
pgtool_offline pg_restore --list "$dump" > /dev/null || die "The decrypted file is not a valid PostgreSQL archive"

# 3. Replace the staging copy (only reached for an empty or previously restored database).
if [[ "$public_tables" != 0 ]]; then
  echo "Clearing the previous restore-check copy..."
  q "set client_min_messages = warning; drop schema public cascade; create schema public;" > /dev/null
fi
echo "Restoring $blob ..."
pgtool pg_restore --no-owner --no-acl --exit-on-error --single-transaction --dbname="$PGDATABASE" "$dump"
rm -f "$dump"

# 4. Verify: counts only, never row contents.
read -r orgs users sus docs objects bytes_ok migration < <(q "
  select
    (select count(*) from public.\"Organisation\"),
    (select count(*) from public.\"User\"),
    (select count(*) from public.\"ServiceUser\"),
    (select count(*) from public.\"ServiceUserDocument\"),
    (select count(*) from public.\"StoredObject\"),
    (select count(*) = 0 from public.\"StoredObject\" where octet_length(bytes) <> \"sizeBytes\"),
    coalesce((select migration_name from public._prisma_migrations where finished_at is not null order by finished_at desc limit 1), 'none')
" | tr '|' ' ')
[[ "$orgs" -gt 0 ]] || die "Restore check failed: no organisations in the restored copy"
[[ "$bytes_ok" == t ]] || die "Restore check failed: some uploaded documents do not match their recorded size"

q "create schema if not exists csb_restore_check;
   create table if not exists csb_restore_check.marker (restored_at timestamptz not null, blob text not null);
   insert into csb_restore_check.marker values (now(), '$(printf '%s' "$blob" | tr -cd 'A-Za-z0-9/._-')');" > /dev/null
unset PGPASSWORD

summary "### Restore check passed"
summary "- Backup: \`$blob\`"
summary "- Restored into a separate database: \`$PGDATABASE\` (production guard passed)"
summary "- Organisations: $orgs, users: $users, service users: $sus, service-user documents: $docs"
summary "- Stored files: $objects (all sizes match)"
summary "- Latest migration: $migration"
summary "- Duration: $(( $(date +%s) - started )) s"
