# Operations

## Backup and recovery

- **Database**: Azure PostgreSQL Flexible Server automated backups with point-in-time restore (set retention to 35 days for production) plus geo-redundant backup storage. For self-hosting, run `pg_dump -Fc` nightly to off-site storage and test a restore monthly.
- **Files**: enable blob soft delete and versioning on the storage account (30 days). Evidence and raw source captures are referenced by key from the database, so restore the database and storage to the same point in time.
- **Recovery test**: restore to a new server, point a staging deployment at it, sign in and open a policy, a revision and an evidence file.
- **Targets** (suggested): RPO 15 minutes, RTO 4 hours.

Because source versions, approval decisions and the audit log are immutable, a restore never needs those rows reconciled by hand.

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
