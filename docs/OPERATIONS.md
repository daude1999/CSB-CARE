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

## Monitoring and alerts

Added in the enterprise-readiness work (workstream 3). Nothing here is switched on by the code alone: the uptime
monitor and its alert contacts are set up once by the owner in the monitoring service.

### What to watch

| Check | How | Alert when | First action |
| --- | --- | --- | --- |
| Site is up | Uptime monitor requests `GET /api/health` every minute from a UK or EU location | HTTP status is not 200, or the body does not contain `"status":"ok"`, on 2 checks in a row | Open the hosting dashboard; look for a failed deployment and roll back to the last good one. Then check the database provider's status page |
| Background jobs are being worked | Same request, keyword check on the body | The body contains `"queueHealthy":false` for 15 minutes | Platform Admin, Background Jobs. If jobs are waiting, press the queue kick (or restart the worker where there is one). If jobs are "given up", read the error, fix the cause and retry them there |
| Worker heartbeat | Same request | `"workerHealthy":false` for 60 minutes (on Vercel the heartbeat comes from the daily cron and the queue kick, so allow a long window) | As above |
| Sign-in page loads | Uptime monitor requests `GET /login` every 5 minutes | Not 200, or slower than 5 seconds, twice in a row | Hosting dashboard, function logs |
| TLS certificate | Uptime monitor's certificate check | Fewer than 14 days left | Hosting dashboard, Domains |
| Backups ran | Scheduled backup workflow (`docs/BACKUPS.md`) | The workflow fails or has not succeeded in 26 hours | `docs/BACKUPS.md`, "When a backup fails" |

`/api/health` needs no sign-in and returns counts only:

```json
{ "status": "ok", "database": "ok", "workerHeartbeatAgeSeconds": 412, "workerHealthy": true,
  "queue": { "waiting": 0, "running": 0, "oldestWaitingMinutes": null, "failedLast24Hours": 0, "givenUp": 0 },
  "queueHealthy": true }
```

- `status` is `ok` when the database answers; otherwise the route returns HTTP 503 with `"status":"error"`.
- `queueHealthy` is `false` when a job that is due has waited more than 30 minutes, or a job has been given up on
  after every retry. The site still answers 200, so a slow queue is an alert, not an outage.

### Who is told, and how fast

| Severity | Examples | Told | Target |
| --- | --- | --- | --- |
| Critical | Site down, database unreachable, sign-in failing, one organisation seeing another's records | Phone call or SMS to the on-call person, then the owner | Acknowledge in 15 minutes, any hour |
| High | `queueHealthy` false, backups failing, error rate spike | Email and SMS to the on-call person | Same working day |
| Low | Certificate expiring, one job given up | Email | Within 3 working days |

**[OWNER]** names the on-call person, a deputy and their phone numbers in the monitoring service, not in this
repository. A data incident follows `docs/assurance/INCIDENT_RESPONSE.md` (the 72-hour clock starts when someone
becomes aware).

### Setting up the uptime monitor

Any uptime service that supports keyword checks and SMS works (for example UptimeRobot, Better Stack or
StatusCake). It only requests public pages and receives no personal data, so it is not a data processor.

1. Add an HTTPS keyword monitor for `https://<site>/api/health`, every minute, keyword `"status":"ok"` must exist.
2. Add a second keyword monitor on the same address, every 5 minutes, keyword `"queueHealthy":false` must **not**
   exist, alerting after 15 minutes.
3. Add an HTTPS monitor for `https://<site>/login` with a 5-second timeout.
4. Switch on the certificate expiry check.
5. Add the alert contacts and send a test alert to each.

### Finding the logs for a problem

Every response carries an `x-request-id` header, and every log line written while that request was handled carries
the same `requestId`. When someone reports a problem:

1. Ask for the time and, if they can, the error reference shown on screen ("Error reference: ...").
2. In the hosting logs, search for the reference (`ref`) or the `requestId` (browser developer tools, Network, the
   failed request's response headers).
3. All lines with that `requestId` belong to that one request. Unhandled errors appear as `"msg":"request failed"`.

Logs hold ids, counts and error kinds only. Personal and care-record fields are replaced with `[Redacted]` by the
logger (`src/lib/logger.ts`, checked by `tests/unit/log-redaction.test.ts`). Free text placed in an error message is
not covered, so never build an error message from a record's content.

### Error tracking (Sentry, EU region)

Approved by the owner on 10 Nov 2026. **Off until the owner sets it up:**

1. Create a Sentry account and choose the **EU (Frankfurt)** data region when asked. The region cannot be changed later.
2. Create a project (platform: Next.js). Copy its DSN, which looks like `https://...@o123.ingest.de.sentry.io/456`.
3. In Vercel, Project, Settings, Environment Variables, add `SENTRY_DSN` with that value for Production, then redeploy.
4. In Sentry, add an alert rule: email (and SMS if the plan has it) on every new issue.
5. Sign Sentry's data processing agreement and add Sentry to the processor list in `docs/assurance/DATA_FLOW.md`.

What it does and does not send (`src/lib/error-tracking.ts`, checked by `tests/unit/error-tracking.test.ts`, which
starts the real SDK and reads what it would send):

- Server-side errors only. Browsers send nothing to Sentry, so the Content Security Policy is unchanged.
- It refuses to start unless the DSN is in the EU region (the address must end in `.de.sentry.io`), and logs why.
- Sent: the error's kind, the first line of its message with emails, links, quoted values, postcodes, phone numbers
  and any number of four or more digits masked, the stack trace (file names and line numbers), the route pattern
  (for example `/rota/service-users/[id]`, never the address with its ids), the request id, the error reference shown
  to the user, and the release.
- Never sent: request bodies, form data, cookies, headers, query strings, the signed-in user, breadcrumbs, local
  variables, performance traces. Database errors are reduced to "Database error P2002"-style codes, because their
  full messages can quote the record being saved.
- To switch it off, remove `SENTRY_DSN` and redeploy.

To find the log lines for a Sentry issue, search the hosting logs for its `requestId` or `errorRef` tag.

## Account emails

Invitations and password resets are emailed when a mail server is configured (`EMAIL_PROVIDER=smtp` with the `SMTP_*`
settings and `EMAIL_FROM`). Until then nothing is emailed and the administrator copies the one-time link, as before.

- The link is always shown to the administrator as well, so a failed or blocked email never locks anyone out.
- Limits per hour: 5 account emails to one address and 30 sent by one administrator (plus the existing limit on reset
  links per person). Over a limit, nothing is sent and the administrator is told to copy the link.
- The audit log records each email as sent, blocked or failed (`account.email.*`). Links are never stored or logged.
- Set `APP_URL` to the site's public address, or links in emails will use whatever host the request arrived on.
- Before going live: use a sending domain with SPF, DKIM and DMARC set up, and add the mail provider to the processor
  list in `docs/assurance/DATA_FLOW.md`. It receives names, email addresses and one-time links only.

