-- Integrity, immutability and search support that Prisma cannot express directly.

-- Master templates have no organisation; customer policies always have one.
ALTER TABLE "Policy" ADD CONSTRAINT policy_kind_org_chk
  CHECK (("kind" = 'MASTER' AND "organisationId" IS NULL) OR ("kind" = 'CUSTOMER' AND "organisationId" IS NOT NULL));

-- Customer policy versions must carry the same organisation as their policy.
CREATE OR REPLACE FUNCTION evx_policy_version_org() RETURNS trigger AS $$
DECLARE p_org text;
BEGIN
  SELECT "organisationId" INTO p_org FROM "Policy" WHERE id = NEW."policyId";
  IF NEW."organisationId" IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'PolicyVersion.organisationId must match Policy.organisationId';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER policy_version_org BEFORE INSERT OR UPDATE ON "PolicyVersion"
  FOR EACH ROW EXECUTE FUNCTION evx_policy_version_org();

-- Source versions are immutable records of what was retrieved.
CREATE OR REPLACE FUNCTION evx_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (%)', TG_TABLE_NAME, TG_OP;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER source_version_immutable BEFORE UPDATE OR DELETE ON "SourceVersion"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();
CREATE TRIGGER approval_decision_immutable BEFORE UPDATE OR DELETE ON "ApprovalDecision"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();

-- Policy version content is frozen once it leaves the editable states,
-- and status may only move along the approved state machine.
CREATE OR REPLACE FUNCTION evx_policy_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('DRAFT') THEN
      RAISE EXCEPTION 'Cannot delete policy version in status %', OLD.status;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status NOT IN ('DRAFT', 'CHANGES_REQUESTED') THEN
    IF NEW."policyId" <> OLD."policyId" OR NEW."versionNumber" <> OLD."versionNumber"
       OR NEW."changeSummary" IS DISTINCT FROM OLD."changeSummary"
       OR NEW."reasonForChange" IS DISTINCT FROM OLD."reasonForChange"
       OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
       OR NEW."previousVersionId" IS DISTINCT FROM OLD."previousVersionId" THEN
      RAISE EXCEPTION 'Policy version % is % and its content is immutable', OLD.id, OLD.status;
    END IF;
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('UNDER_REVIEW', 'REJECTED')) OR
       (OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('CHANGES_REQUESTED', 'APPROVED', 'REJECTED')) OR
       (OLD.status = 'CHANGES_REQUESTED' AND NEW.status IN ('UNDER_REVIEW', 'REJECTED')) OR
       (OLD.status = 'APPROVED' AND NEW.status IN ('SCHEDULED', 'PUBLISHED', 'REJECTED')) OR
       (OLD.status = 'SCHEDULED' AND NEW.status IN ('PUBLISHED', 'APPROVED')) OR
       (OLD.status = 'PUBLISHED' AND NEW.status IN ('SUPERSEDED', 'ARCHIVED')) OR
       (OLD.status = 'SUPERSEDED' AND NEW.status IN ('ARCHIVED'))
     ) THEN
    RAISE EXCEPTION 'Illegal policy version transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER policy_version_guard BEFORE UPDATE OR DELETE ON "PolicyVersion"
  FOR EACH ROW EXECUTE FUNCTION evx_policy_version_guard();

-- Sections can only be written while their version is editable.
CREATE OR REPLACE FUNCTION evx_policy_section_guard() RETURNS trigger AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM "PolicyVersion"
   WHERE id = COALESCE(NEW."versionId", OLD."versionId");
  IF v_status IS NOT NULL AND v_status NOT IN ('DRAFT', 'CHANGES_REQUESTED') THEN
    RAISE EXCEPTION 'Sections of a % policy version are immutable', v_status;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER policy_section_guard BEFORE INSERT OR UPDATE OR DELETE ON "PolicySection"
  FOR EACH ROW EXECUTE FUNCTION evx_policy_section_guard();

-- Exactly one published version per policy at any time.
CREATE UNIQUE INDEX one_published_version_per_policy
  ON "PolicyVersion" ("policyId") WHERE status = 'PUBLISHED';

-- Full-text search (PostgreSQL FTS; pgvector can be added where the extension is available).
-- search_vector columns are maintained by triggers so the Prisma schema stays drift-free.
CREATE OR REPLACE FUNCTION evx_chunk_tsv() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := setweight(to_tsvector('english', coalesce(NEW.heading, '')), 'A') ||
                       setweight(to_tsvector('english', coalesce(NEW.text, '')), 'B');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER document_chunk_tsv BEFORE INSERT OR UPDATE OF heading, text ON "DocumentChunk"
  FOR EACH ROW EXECUTE FUNCTION evx_chunk_tsv();

CREATE OR REPLACE FUNCTION evx_policy_tsv() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
                       setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER policy_tsv BEFORE INSERT OR UPDATE OF title, description ON "Policy"
  FOR EACH ROW EXECUTE FUNCTION evx_policy_tsv();
