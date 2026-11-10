-- Row-level security, step 1: the application role and a pilot on three high-risk tables.
--
-- Why: tenant isolation so far rests on every query carrying its organisationId filter. Row-level security makes
-- the database refuse rows of another organisation even when a query forgets that filter.
--
-- How it works (src/lib/db.ts, src/server/tenancy):
--   * The application keeps its one login. Every transaction it opens first switches to the role csb_app
--     (set_config('role', 'csb_app', true)) and sets two transaction-local settings:
--       app.organisation_id  the signed-in session's organisation, or '' when there is none
--       app.rls_bypass       'on' only inside the audited system scope (Platform Admin, seeds, worker, sign-in lookups)
--   * csb_app is not a superuser, does not own the tables and has no BYPASSRLS, so the policies below apply to it.
--   * With neither setting, a protected table shows no rows and refuses writes (default deny).
--
-- Additive and data-safe: this creates a role, grants and policies. It changes no rows.
-- Rollback: for each table, DROP POLICY tenant_isolation ON "<table>"; ALTER TABLE "<table>" NO FORCE ROW LEVEL
-- SECURITY; ALTER TABLE "<table>" DISABLE ROW LEVEL SECURITY; and set DB_ROW_LEVEL_SECURITY=off for the app.
--
-- Note for later migrations: FORCE applies the policies to the table owner too (unless it is a superuser or has
-- BYPASSRLS). A migration that changes data in a protected table must start with
--   SELECT set_config('app.rls_bypass', 'on', true);
-- inside its transaction.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'csb_app') THEN
    CREATE ROLE csb_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- The login role must be a member to switch to it.
GRANT csb_app TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO csb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO csb_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO csb_app;
-- Tables and sequences created by later migrations (run by this same login) get the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO csb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO csb_app;
-- Prisma's own bookkeeping is not application data.
REVOKE ALL ON TABLE "_prisma_migrations" FROM csb_app;

-- Pilot tables.
ALTER TABLE "ServiceUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceUser" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServiceUser"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CareIntakeDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareIntakeDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareIntakeDocument"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "ServiceUserExternalReference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceUserExternalReference" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServiceUserExternalReference"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));
