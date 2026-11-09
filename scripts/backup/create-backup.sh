#!/usr/bin/env bash
# Nightly encrypted backup: dump -> validate -> encrypt with age -> upload to private Azure Blob.
# Env: BACKUP_DATABASE_URL (direct, unpooled Neon URL), BACKUP_AGE_RECIPIENT (one or more age public keys,
#      one per line or comma-separated), AZURE_BACKUP_CONTAINER_SAS_URL (container SAS, create+write).
# The plaintext dump only ever exists inside a private temporary folder that is removed on exit.
set -euo pipefail
# shellcheck source=scripts/backup/common.sh
source "$(dirname "$0")/common.sh"

: "${BACKUP_DATABASE_URL:?Add the direct Neon connection string as the BACKUP_DATABASE_URL Actions secret}"
: "${BACKUP_AGE_RECIPIENT:?Add the age public key as the BACKUP_AGE_RECIPIENT Actions variable}"
: "${AZURE_BACKUP_CONTAINER_SAS_URL:?Add the container SAS URL as the AZURE_BACKUP_CONTAINER_SAS_URL Actions secret}"

require_tools node age age-keygen
make_workdir
started=$(date +%s)

# 1. Check the storage target before touching the database.
node "$BACKUP_SCRIPTS/blob.mjs" preflight-upload

# 2. Encryption recipients (public keys only).
recipients="$WORK/recipients.txt"
tr ',' '\n' <<<"$BACKUP_AGE_RECIPIENT" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' > "$recipients" || true
[[ -s "$recipients" ]] || die "BACKUP_AGE_RECIPIENT is empty"
if grep -q 'AGE-SECRET-KEY' "$recipients"; then die "BACKUP_AGE_RECIPIENT contains a PRIVATE key. Remove it from GitHub now and set the public key (age1...) instead"; fi
grep -qv '^age1' "$recipients" && die "BACKUP_AGE_RECIPIENT must contain age public keys starting with age1"

# 3. Dump in PostgreSQL custom format. This includes uploaded documents held in the StoredObject table.
load_pg_env BACKUP_DATABASE_URL --direct
blob_name="$(BACKUP_LIB="$BACKUP_SCRIPTS/lib.mjs" node --input-type=module -e 'const m = await import(process.env.BACKUP_LIB); console.log(m.backupBlobName())')"
dump="$WORK/csb-care.dump"
echo "Dumping the database (custom format)..."
pgtool pg_dump --format=custom --compress=6 --no-owner --no-acl --file="$dump"
unset PGPASSWORD

# 4. Validate: readable archive with data for the core tables, documents included.
[[ -s "$dump" ]] || die "pg_dump produced an empty file"
toc="$WORK/toc.txt"
pgtool_offline pg_restore --list "$dump" > "$toc" || die "The dump could not be read back by pg_restore"
missing="$(BACKUP_LIB="$BACKUP_SCRIPTS/lib.mjs" node --input-type=module -e '
  const fs = await import("node:fs");
  const m = await import(process.env.BACKUP_LIB);
  console.log(m.missingTablesInToc(fs.readFileSync(process.argv[1], "utf8")).join(", "));
' "$toc")"
[[ -z "$missing" ]] || die "The dump is missing table data for: $missing"
entries=$(grep -c ' TABLE DATA ' "$toc" || true)
dump_bytes=$(stat -c %s "$dump")
echo "Dump validated: $entries tables with data, $dump_bytes bytes."

# 5. Encrypt, then remove the plaintext immediately.
encrypted="$WORK/csb-care.dump.age"
age --encrypt --recipients-file "$recipients" --output "$encrypted" "$dump"
rm -f "$dump" "$toc"
[[ "$(head -c 21 "$encrypted")" == "age-encryption.org/v1" ]] || die "Encryption did not produce an age file"

# 6. Upload (never overwrites an existing blob).
node "$BACKUP_SCRIPTS/blob.mjs" upload "$encrypted" "$blob_name"

summary "### Encrypted database backup"
summary "- Blob: \`$blob_name\`"
summary "- Tables with data: $entries (core tables and uploaded documents present)"
summary "- Plain dump size: $dump_bytes bytes; encrypted size: $(stat -c %s "$encrypted") bytes"
summary "- Duration: $(( $(date +%s) - started )) s"
