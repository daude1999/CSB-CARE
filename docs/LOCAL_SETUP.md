# Running CSB on your own Windows computer

This guide sets up the whole platform (web app, background worker and database) on one Windows 10 or 11 computer. Nothing here touches the live demo on Vercel or any hosted database. Each step is a command you copy into **PowerShell** (press Start, type "PowerShell", open it).

## 1. Install the tools (once)

| Tool | Where | Notes |
|---|---|---|
| Node.js 22 LTS | nodejs.org → "Download Node.js (LTS)" | Accept the defaults. |
| PostgreSQL 16 | postgresql.org → Download → Windows → "Download the installer" | Choose a password for the `postgres` user and write it down. Keep port 5432. Stack Builder is not needed. |
| Git | git-scm.com/download/win | Accept the defaults. |

Close and reopen PowerShell, then check:

```powershell
node --version      # v22.x
npm --version
git --version
```

If PowerShell says running scripts is disabled when you type `npm`, run this once and answer Y:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 2. Get the code (once)

```powershell
cd $HOME\Documents
git clone https://github.com/daude1999/CSB-CARE.git
cd CSB-CARE
npm install
```

## 3. Create the databases (once)

Open **pgAdmin 4** (installed with PostgreSQL), sign in with the `postgres` password, right-click **Databases → Create → Database…** and create three databases: `csb` (the app), `csb_test` and `csb_e2e` (the automatic tests). If you use Docker Desktop instead of installing PostgreSQL, `docker compose up -d db` starts PostgreSQL 16 with all three databases and the password `postgres`; skip the rest of this step. Or, in PowerShell:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres csb
& "C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres csb_test
& "C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres csb_e2e
```

## 4. Settings (once)

```powershell
Copy-Item .env.example .env
notepad .env
```

In Notepad, change the first setting so that `YOURPASSWORD` is your `postgres` password, then save:

```
DATABASE_URL=postgresql://postgres:YOURPASSWORD@localhost:5432/csb?schema=public
```

Leave `EMAIL_PROVIDER=log`: emails are written to the outbox and the log, never sent.

## 5. Load the database

Choose one.

**With the demo data** (sample organisation, people, visits and policies, for trying things out):

```powershell
npm run db:reset:local
```

**Empty, ready for your real organisation:**

```powershell
npm run db:reset:local -- --clean
npm run org:create -- --name "Care Solution Bureau CIC" --branches "Liverpool,Portsmouth,Tower Hamlets" --admin-email you@example.com --admin-name "Your Name"
```

`org:create` prints a one-time link. Open it in the browser after step 6, choose a password (at least 12 characters) and sign in. Then invite everyone else from **Administration → Users**.

On Windows you can also run `.\scripts\local-reset.ps1` (add `-Clean` for an empty database); on macOS or Linux, `./scripts/local-reset.sh`. Both commands ask you to type `RESET` first, because they delete everything in the local `csb` database. They refuse to run if `DATABASE_URL` points anywhere other than this computer.

## 6. Start it

Two PowerShell windows, both in the `CSB-CARE` folder:

```powershell
npm run dev        # window 1: the web app, at http://localhost:3000
```

```powershell
npm run worker     # window 2: call monitoring, missed medication, reminders and other background jobs
```

Stop either with **Ctrl+C**. Or start both in one window with `npm run dev:all` (one Ctrl+C stops both).

Demo sign-ins and the demo password are listed in `README.md`.

## 7. Before you put real data in

1. Run the checks in step 8 and make sure they all pass.
2. Start from an empty database (`npm run db:reset:local -- --clean`), not the demo data.
3. Medication records stay switched off until an organisation admin switches them on in **Rostering → Rota Settings** and records who carried out the clinical safety review.
4. Back up the database regularly (step 9). The local database lives only on this computer.

## 8. Run the automatic checks

```powershell
npm run typecheck
npm run lint
npm test                 # unit and integration tests; empties and refills csb_test
npm run test:hr          # HR Hub tests (no database)
npx playwright install chromium   # once
npm run build
npm run test:e2e         # browser tests; empties and refills csb_e2e, uses port 3100
```

The first time you run `test:e2e`, prepare its database once:

```powershell
$env:DATABASE_URL="postgresql://postgres:YOURPASSWORD@localhost:5432/csb_e2e?schema=public"; npx prisma migrate deploy; Remove-Item Env:DATABASE_URL
```

The tests use `csb_test` and `csb_e2e` with the password `postgres` by default. If yours is different, set it for the session first:

```powershell
$env:TEST_DATABASE_URL="postgresql://postgres:YOURPASSWORD@localhost:5432/csb_test?schema=public"
$env:E2E_DATABASE_URL="postgresql://postgres:YOURPASSWORD@localhost:5432/csb_e2e?schema=public"
```

## 9. Back up and restore

```powershell
# back up to a file in Documents
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U postgres -Fc -f "$HOME\Documents\csb-backup.dump" csb
# restore that file into an empty csb database
& "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" -U postgres -d csb --clean --if-exists "$HOME\Documents\csb-backup.dump"
```

Uploaded evidence files are kept in the folder set by `STORAGE_LOCAL_DIR` (default `.data\storage` inside `CSB-CARE`). Copy that folder with the backup.

## 10. Getting the latest version

```powershell
git pull
npm install
npx prisma migrate deploy   # applies new database changes; keeps your data
```

## If something goes wrong

| Message | What to do |
|---|---|
| `password authentication failed for user "postgres"` | The password in `.env` does not match the one chosen when PostgreSQL was installed. |
| `Can't reach database server at localhost:5432` | PostgreSQL is not running: Start → "Services" → find `postgresql-x64-16` → Start. |
| `Port 3000 is in use` | Another copy is running. Close the other PowerShell window or restart the computer. |
| `extension "btree_gist" is not available` | Reinstall PostgreSQL 16 with the default components; the extension ships with it. |
| `Refusing: DATABASE_URL points at …` | The reset only works on this computer's database. Check `.env`. |
| The browser tests time out while starting | Run the one-off `csb_e2e` preparation command in step 8, then try again. |
