# Operations

## Backup and recovery

- **Current deployment**: Vercel uses the Neon PostgreSQL integration. The app stores uploads in the `StoredObject` table on Vercel, so one PostgreSQL dump covers the records and uploaded files. Do not assume that the Vercel filesystem is persistent.
- **Neon recovery**: the linked Neon integration is on its Free plan. Neon’s current default restore history for Free projects is short (6 hours or 1 GB of changes, whichever is reached first); this is useful for quick recovery, not a separate off-site backup. Check the project’s configured retention in Neon before relying on it.
- **Off-site backup workflow**: `.github/workflows/postgres-backup.yml` creates a nightly PostgreSQL custom-format dump, validates it, encrypts it with `age`, and uploads it to a private Azure Blob container. It requires an organisation-controlled Linux x64 self-hosted runner labelled `csb-approved-uk`; this keeps care records off GitHub-hosted runners. It is deliberately inactive until the runner and remaining prerequisites below exist. Use a direct, unpooled Neon connection string for `BACKUP_DATABASE_URL`; never put that value in a workflow file.
- **Required GitHub Actions configuration**: add `BACKUP_DATABASE_URL` and `AZURE_STORAGE_CONNECTION_STRING` as Actions secrets; set `BACKUP_AGE_RECIPIENT`, `AZURE_STORAGE_CONTAINER` and `BACKUP_ENABLED=true` as Actions variables. Keep the matching `age` private identity offline in the organisation’s approved credential store. Until `BACKUP_ENABLED=true`, scheduled runs skip the backup job. Secrets are exposed only to the backup upload step, and the workflow logs only the encrypted blob name and size.
- **Azure retention**: create a private container in the approved region, enable blob versioning and soft delete, and add a lifecycle rule to delete `postgres/` blobs after the approved retention period (30 days is the initial proposal). Keep Azure storage in an approved UK region and confirm the relevant data-processing terms before using real care records.
- **Recovery test**: at least monthly, decrypt a copy in an approved environment, restore it to a new isolated PostgreSQL database (never over production), then point staging at it and verify sign-in, a policy, a care plan and an uploaded document. Record the backup timestamp, restore duration and result.
- **Targets** (initial proposal): RPO 24 hours for the off-site copy, RTO 4 hours. Neon’s shorter PITR window may allow a more recent recovery for accidental changes.

The backup runner must be hosted and administered in the organisation’s approved UK environment, have Docker available, and be restricted to this private-data workflow. Do not enable the schedule until the runner, Azure storage region and data-processing terms have been checked and approved.

Because source versions, approval decisions and the audit log are immutable, a restore never needs those rows reconciled by hand. Backups are sensitive personal data: restrict container access, protect the decryption identity, and do not upload dump files or decrypted restore copies to GitHub artifacts.

## Runbook

| Symptom | Check | Action |
| --- | --- | --- |
| Overview shows stale or failing sources | `/admin/sources/<id>` runs and processing log | Fix network or URL, then **Check now**. Three failures in a row alert platform admins |
| Banner: worker has not reported | `/api/health` → `workerHealthy` | Restart the worker app. Stale job locks are recovered automatically |
| Jobs in DEAD | `/admin/jobs?status=DEAD` | Read `lastError`, fix the cause, **Retry** |
| AI unavailable | Settings page shows the provider | Check `ANTHROPIC_API_KEY`; work continues manually meanwhile |
| Emails not arriving | `NotificationDelivery` rows and logs | Check SMTP settings; deliveries retry with backoff |

## Retention

Evidence has an optional `retainUntil` date. Source versions are kept indefinitely so citations remain checkable. Sessions expire after 12 hours without activity; expired rows can be purged.
