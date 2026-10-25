-- Rebrand: starter library references change from EVX-* to CSB-* (for example
-- CSB-SAF-001). Immutable records (approved policy versions and their
-- sections, source versions, approval decisions and the audit log) are left
-- exactly as recorded.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND data_type IN ('text', 'character varying')
       AND table_name NOT IN ('AuditLog', 'ApprovalDecision', 'SourceVersion', 'PolicyVersion', 'PolicySection', '_prisma_migrations')
  LOOP
    EXECUTE format('UPDATE %I SET %I = replace(%I, ''EVX-'', ''CSB-'') WHERE %I LIKE ''%%EVX-%%''', c.table_name, c.column_name, c.column_name, c.column_name);
  END LOOP;
END $$;
