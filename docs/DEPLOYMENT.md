# Deployment

The app runs as two processes from one image: the **web** app and the **worker**. Both need the same `DATABASE_URL` and storage settings. Run migrations once per release before starting new versions.

## Docker Compose (single host)

```bash
cp .env.example .env    # set AI, email and storage options; SEED_DEMO=false for real use
POSTGRES_PASSWORD=$(openssl rand -hex 16) docker compose up -d --build
docker compose run --rm web seed     # once: reference data (and demo data if SEED_DEMO=true)
```

Image commands: `web` (default), `worker`, `migrate`, `seed`, `monitor-once <source-key>`.

Note: the Dockerfile has not been built in the development environment (Docker was not available there). It uses standard Node 22 images and the same commands the tests use.

## Azure (recommended layout)

| Component | Azure service |
| --- | --- |
| Web | Azure Container Apps (min 1 replica, HTTP ingress on port 3000, health probe `/api/health`) |
| Worker | Second Container App from the same image with command `worker`, no ingress, exactly 1 replica |
| Database | Azure Database for PostgreSQL Flexible Server 16, zone-redundant HA for production, private networking |
| Files | Azure Blob Storage, private container, `STORAGE_PROVIDER=azure` |
| Secrets | Azure Key Vault referenced by Container Apps secrets (database URL, Anthropic key, SMTP password, storage connection string) |
| Email | Azure Communication Services Email or any SMTP relay (`EMAIL_PROVIDER=smtp`) |
| Images | Azure Container Registry |
| Logs | Log Analytics (the app writes structured JSON logs to stdout, with secrets redacted) |
| Malware scanning | Microsoft Defender for Storage, or a scanner behind `MALWARE_SCAN_URL` |

Steps:

1. Create the resource group, PostgreSQL server (database `evantix`), storage account and private container, Key Vault and container registry.
2. `az acr build -r <registry> -t evantix-care:<version> .`
3. Run migrations as a Container Apps job: same image, command `migrate`.
4. Create the web and worker apps with the environment from `.env.example`. Set `APP_URL` to the public URL, `COOKIE_SECURE=true`, `SEED_DEMO=false`, and leave `SHOW_DEMO_LOGINS` unset.
5. Run the seed once (job with command `seed`) to load service types, categories, the source registry, starter templates and the requirements register.
6. Create the first platform admin and organisation (see below), then confirm each automated source with `monitor-once` as described in [SOURCES.md](SOURCES.md).

The worker must be a single replica: jobs are claimed safely with row locks, so more replicas are allowed, but the scheduler tick is designed around one.

## Vercel + Supabase (demo only)

For a shareable demo, not production. The app runs on Vercel and the database on Supabase.

1. Supabase: create a project, then copy the **Session pooler** connection string (Connect > ORMs or Connection string > Session pooler). Vercel cannot reach the IPv6-only direct connection.
2. Vercel: import the GitHub repo and set these environment variables:
   ```
   DATABASE_URL=<session pooler string, with the real password>
   AI_PROVIDER=simulated
   SHOW_DEMO_LOGINS=true
   CRON_SECRET=<any long random string>
   ```
3. Deploy. Functions run in London (`lhr1` in `vercel.json`) to sit next to a London Supabase database. The `vercel-build` script applies migrations, seeds the demo data only when the database has no users yet, then builds.

There is no separate worker on Vercel. Instead, signed-in pages ping `/api/jobs/kick` after loading to process a few queued jobs (`INLINE_JOBS`, on by default when `VERCEL` is set), and Vercel Cron calls `/api/cron/tick` daily. Uploaded evidence is kept under `/tmp` and does not persist; use `STORAGE_PROVIDER=azure` if that matters.

## Creating the first users

There is no self-service sign-up in this slice. Create the first platform admin and organisation from a one-off shell in the image (`npx tsx`), using `hashPassword` from `src/server/auth/password.ts` and Prisma `user.create` / `organisation.create` / `membership.create`. An admin user-management screen is a planned next step.

## AI configuration

`AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY`. The model defaults to `claude-opus-5-5` (override with `ANTHROPIC_MODEL`). Without a key, or with `AI_PROVIDER=none`, AI features are switched off and every step can be done manually; nothing else is affected. Source text is passed to the model as untrusted data and outputs are validated against schemas before use.
