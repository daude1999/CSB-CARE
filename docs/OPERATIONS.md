# Operations

## Backup and recovery

- **Current deployment**: Vercel uses the Neon PostgreSQL integration. The app stores uploads in the `StoredObject` table on Vercel, so one PostgreSQL dump covers the records and uploaded files. Do not assume that the Vercel filesystem is persistent.
- **Neon recovery**: the linked Neon integration is on its Free plan. Neon’s current default restore history for Free projects is short (6 hours or 1 GB of changes, whichever is reached first); this is useful for quick recovery, not a separate off-site backup. Check the project’s configured retention in Neon before relying on it.
- **Off-site backup**: a nightly encrypted dump to a private Azure Blob container, run only on an organisation-controlled UK self-hosted runner (`csb-approved-uk`), with a monthly restore check into a separate staging database. It is built but **not active** until the runner, storage, keys and GitHub settings exist. Setup, retention, restore and the exact secret and variable names are in [BACKUPS.md](BACKUPS.md).
- **Targets** (initial proposal): RPO 24 hours for the off-site copy, RTO 4 hours. Neon’s shorter PITR window may allow a more recent recovery for accidental changes.

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
