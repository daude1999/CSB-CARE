# Encrypted database backups

Status: **built, not active.** No real backup has been uploaded and no real restore has been verified yet. Do not describe backups as running until the first nightly backup has uploaded and a restore check has passed (see "Turning it on").

## What is backed up

The live app runs on Vercel with a Neon PostgreSQL database. Uploaded files, including service-user documents and support plans, are stored inside PostgreSQL in the `StoredObject` table (`STORAGE_PROVIDER=database`). One PostgreSQL dump therefore covers every record and every uploaded document.

Each nightly run:

1. checks that the Azure container is reachable and refuses to continue if it allows anonymous access;
2. dumps the database with `pg_dump --format=custom` over the **direct (unpooled)** Neon connection (a `-pooler` host is refused);
3. validates the dump with `pg_restore --list` and checks that table data is present for `Organisation`, `User`, `ServiceUser`, `ServiceUserDocument`, `StoredObject` (uploaded files), `AuditLog` and `_prisma_migrations`;
4. encrypts it with `age` to the public key(s) in `BACKUP_AGE_RECIPIENT`, and deletes the plain dump immediately;
5. uploads only the encrypted file to `postgres/<UTC time>/csb-care.dump.age` in the private container, never overwriting an existing blob, and records a SHA-256 checksum in the blob's metadata;
6. checks again that the uploaded blob cannot be read without a key.

Plain dumps exist only in a private (mode 700) temporary folder on the runner. The scripts remove it when they finish, fail or are cancelled, and a final `if: always()` step removes it again. Nothing is uploaded as a GitHub artifact. Logs show blob names, sizes, checksums and row counts only, never connection strings, SAS tokens or record contents. Passwords reach `pg_dump`/`psql` as environment variables, not command-line arguments.

| Piece | File |
|---|---|
| Nightly workflow (02:37 UTC) | `.github/workflows/postgres-backup.yml` |
| Monthly restore check (04:17 UTC on the 3rd) | `.github/workflows/postgres-restore-check.yml` |
| Backup script | `scripts/backup/create-backup.sh` |
| Restore script (staging only) | `scripts/backup/restore-to-staging.sh` |
| Azure upload/download (no SDK, Node 22 only) | `scripts/backup/blob.mjs` |
| Rules (SAS checks, production guard, dump checks) | `scripts/backup/lib.mjs`, tested in `tests/unit/backup-scripts.test.ts` |
| Synthetic end-to-end check on pull requests | `.github/workflows/backup-scripts-check.yml` (throwaway database, Azurite emulator, throwaway key) |

## Runner requirements

Both backup workflows run only on `runs-on: [self-hosted, linux, x64, csb-approved-uk]` and stop at once if `RUNNER_ENVIRONMENT` is not `self-hosted`. Care records never pass through a GitHub-hosted runner.

The runner must be:

- **Organisation-controlled and in the UK**: a Linux x64 virtual machine the organisation owns and administers in an approved UK location (for example an Azure VM in UK South). Full-disk encryption on, OS patched automatically, admin access limited to named people.
- **Registered to this repository only** (Repository → Settings → Actions → Runners → New self-hosted runner), not shared across an organisation, with the extra label **`csb-approved-uk`**. No other workflow may use that label. Run the runner service as a dedicated non-admin user.
- **Tooled**: Docker Engine (the runner user in the `docker` group), `age` and `age-keygen` (`sudo apt-get install age` on Ubuntu 22.04 or later), bash 4.4+, GNU coreutils. Node 22 is installed by `actions/setup-node`.
- **Able to reach**: `github.com` (runner and checkout), the Neon host on port 5432, `<account>.blob.core.windows.net` on 443, and Docker Hub for the `postgres:17-alpine` image (or pre-pull it, or set `BACKUP_PG_IMAGE` to an approved mirror).
- **Sized**: free temporary disk of at least twice the database size.

The PostgreSQL client image must be the same major version as the Neon server or newer (`postgres:17-alpine` by default; set `BACKUP_PG_IMAGE` to change it). The restore-check database must run the same major version as production.

## Azure container settings

Create these by hand before turning the workflow on. The scripts never create, change or delete storage.

**Storage account**

- Region **UK South** (or UK West). Redundancy GRS or GZRS, which keeps the copy in the UK pair.
- Secure transfer required; minimum TLS 1.2.
- **Allow Blob anonymous access: Disabled.**
- Networking: "Enabled from selected networks", allowing only the runner's public IP (and the admins' IPs for the portal), if the runner has a fixed IP.
- Data protection: **blob versioning on**, **blob soft delete 30 days**, **container soft delete 30 days**.
- Optional but recommended: a version-level immutability (WORM) policy of 30 days on the container, so a leaked key cannot erase backups.
- Diagnostic logging of blob reads, writes and deletes to a Log Analytics workspace.

**Container**

- Name, for example `csb-db-backups`. **Public access level: Private (no anonymous access).**
- Two stored access policies (they make each SAS revocable without rotating the account key):
  - `csb-backup-write`: permissions **Create + Write** only, expiry 12 months.
  - `csb-restore-read`: permissions **Read + List** only, expiry 12 months.
- Generate a **container-level** SAS from each policy (Container → Shared access tokens → choose the stored access policy, HTTPS only). Account-level SAS tokens are refused by the scripts, as are a backup SAS with delete or list rights and a restore SAS with any write right. The scripts warn 30 days before a SAS expires.

**Retention (initial proposal, owner to confirm)**

Lifecycle management rule on prefix `csb-db-backups/postgres/`:

- move base blobs to the Cool tier 7 days after creation;
- delete base blobs 35 days after creation (about 30 nightly copies plus margin);
- delete previous versions 7 days after they become previous versions.

Neon's own point-in-time restore on the Free plan covers roughly the last 6 hours (or 1 GB of changes), which helps with a very recent mistake but is not an off-site backup. Targets: RPO 24 hours for the off-site copy, RTO 4 hours.

Confirm the data-processing terms with Microsoft and Neon, and that the Neon project is in London (`aws-eu-west-2`), before real care records are backed up.

## GitHub secrets and variables

Repository → Settings → Secrets and variables → Actions.

**Nightly backup (repository level)**

| Kind | Name | Value |
|---|---|---|
| Secret | `BACKUP_DATABASE_URL` | The **direct, unpooled** Neon connection string for production (host without `-pooler`), for a role that can read every table. |
| Secret | `AZURE_BACKUP_CONTAINER_SAS_URL` | The full container SAS URL from the `csb-backup-write` policy: `https://<account>.blob.core.windows.net/csb-db-backups?sv=…&si=csb-backup-write&sr=c&sig=…` |
| Variable | `BACKUP_AGE_RECIPIENT` | The age **public** key (`age1…`). Several keys may be given, one per line or comma-separated. A private key here is refused. |
| Variable | `BACKUP_ENABLED` | `true` to switch the nightly job on. Set this last. Anything else keeps it off. |
| Variable (optional) | `BACKUP_PG_IMAGE` | PostgreSQL client image. Default `postgres:17-alpine`. |

**Monthly restore check (environment `backup-restore-check`)**

Create the environment under Settings → Environments, add the owner as a **required reviewer**, and limit deployment branches to `main`. Each run then waits for a person to approve it.

| Kind | Name | Value |
|---|---|---|
| Environment secret | `BACKUP_AGE_IDENTITY` | The age **private** key (`AGE-SECRET-KEY-1…`) matching `BACKUP_AGE_RECIPIENT`. |
| Environment secret | `AZURE_RESTORE_CONTAINER_SAS_URL` | Container SAS URL from the `csb-restore-read` policy (Read + List only). |
| Environment secret | `RESTORE_CHECK_DATABASE_URL` | A **separate** staging database, for example a Neon branch or project used only for restore checks. Its database name must contain `restore` or `staging` (for example `csb_restore_check`). |
| Variable | `PRODUCTION_DATABASE_HOSTS` | Production database hostname(s), comma-separated, for example `ep-xxxx.eu-west-2.aws.neon.tech`. Direct and pooled hosts of the same Neon endpoint are both matched. |
| Variable | `RESTORE_CHECK_ENABLED` | `true` to switch the monthly check on. |

Keeping the private key in a protected environment is what lets the restore check run unattended. If the organisation prefers to keep the private key offline only, leave `RESTORE_CHECK_ENABLED` unset and run the manual procedure below each month instead.

The earlier draft used `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_CONTAINER`. They are no longer used by the backup (the app's own `AZURE_STORAGE_CONNECTION_STRING` for `STORAGE_PROVIDER=azure` is unrelated). Do not create them for backups.

## Creating the age key pair

On an approved, offline-capable machine (not the runner):

```bash
age-keygen -o csb-backup-key.txt   # prints "Public key: age1..."
```

- Put the `age1…` public key in the `BACKUP_AGE_RECIPIENT` variable.
- Store `csb-backup-key.txt` (the private key) in the organisation's approved credential store, with a second sealed copy held by another named person. **Without it no backup can ever be decrypted.**
- If using the automated restore check, also paste the `AGE-SECRET-KEY-1…` line into the `BACKUP_AGE_IDENTITY` environment secret.
- Delete the local file afterwards.

## Restore procedure (real recovery)

Never restore over production. Recovery always goes into a new database first; switching the app to it is a separate, owner-approved step.

1. Create a new, empty database that is not production: a new Neon branch or project, with a database named for example `csb_restore_20261109`.
2. On the approved UK runner (or another approved machine with Docker and age), check out this repository.
3. Load credentials without writing them to disk or shell history:
   ```bash
   read -rs RESTORE_TARGET_DATABASE_URL && export RESTORE_TARGET_DATABASE_URL
   read -rs BACKUP_AGE_IDENTITY && export BACKUP_AGE_IDENTITY
   read -rs AZURE_RESTORE_CONTAINER_SAS_URL && export AZURE_RESTORE_CONTAINER_SAS_URL
   export PRODUCTION_DATABASE_HOSTS="ep-xxxx.eu-west-2.aws.neon.tech"
   export RESTORE_BLOB="postgres/20261108T023700Z/csb-care.dump.age"   # omit for the newest
   bash scripts/backup/restore-to-staging.sh
   ```
4. The script refuses the target if it is on a production host, if its name lacks `restore`/`staging`, or if it already holds tables it did not restore itself. It downloads the blob, checks the checksum, decrypts into a private temporary folder, restores in one transaction, checks that every stored file's size matches, prints row counts, and removes all temporary files.
5. Point a staging deployment at the restored database and check sign-in, a policy, a care plan and an uploaded service-user document.
6. Only with the owner's written approval: change the production `DATABASE_URL` on Vercel to the restored database. Record what was done and when.

## Monthly restore check

Automated (when `RESTORE_CHECK_ENABLED=true`): on the 3rd of each month the restore-check workflow waits for approval, then restores the newest backup (or the one named when started by hand) into `RESTORE_CHECK_DATABASE_URL`. The job summary records the backup name, row counts, whether all stored files match, the latest migration and how long it took. Copy that summary into the operations log.

Manual alternative: run the restore procedure above against the dedicated restore-check database each month and record the same facts.

If a check fails, treat backups as broken until a later check passes.

## Turning it on

Done outside this repository, in this order:

1. Approve the UK runner host, the Azure region and the data-processing terms.
2. Build the runner and register it to this repository with the `csb-approved-uk` label.
3. Create the storage account and private container with the settings above, plus the two stored access policies and their SAS URLs.
4. Create the age key pair and store the private key safely.
5. Add the repository secrets and the `BACKUP_AGE_RECIPIENT` variable.
6. Set `BACKUP_ENABLED=true`, run "CSB-CARE encrypted PostgreSQL backup" once by hand (Actions → Run workflow), and confirm an encrypted blob appears in the container. From then on it runs nightly.
7. Create the restore-check database and the `backup-restore-check` environment, then run the restore check by hand and confirm it passes.
8. Only then record backups as active.
