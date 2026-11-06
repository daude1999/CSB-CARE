-- Direct publishing (owner's brief of 5 Nov 2026): an authorised publisher can take a draft straight to publication,
-- without a mandatory review and approval round. The routine lifecycle is DRAFT -> PUBLISHED -> SUPERSEDED / ARCHIVED,
-- with optional scheduling (DRAFT -> SCHEDULED -> PUBLISHED).
--
-- Additive and backwards compatible:
--   * every transition the old state machine allowed is still allowed, so historic rows stay valid;
--   * versions already UNDER_REVIEW or CHANGES_REQUESTED under the old process may return to DRAFT or be published;
--   * a cancelled or conflicting schedule returns its version to DRAFT so it can be corrected and published again;
--   * content stays frozen outside DRAFT / CHANGES_REQUESTED, published versions stay immutable, and the
--     one-published-version index, approval-decision immutability and audit-log immutability are unchanged.
-- No rows are rewritten: historic approval decisions, review assignments and revisions are kept as they are.

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
       (OLD.status = 'DRAFT' AND NEW.status IN ('UNDER_REVIEW', 'REJECTED', 'SCHEDULED', 'PUBLISHED')) OR
       (OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'DRAFT')) OR
       (OLD.status = 'CHANGES_REQUESTED' AND NEW.status IN ('UNDER_REVIEW', 'REJECTED', 'DRAFT', 'SCHEDULED', 'PUBLISHED')) OR
       (OLD.status = 'APPROVED' AND NEW.status IN ('SCHEDULED', 'PUBLISHED', 'REJECTED')) OR
       (OLD.status = 'SCHEDULED' AND NEW.status IN ('PUBLISHED', 'APPROVED', 'DRAFT')) OR
       (OLD.status = 'PUBLISHED' AND NEW.status IN ('SUPERSEDED', 'ARCHIVED')) OR
       (OLD.status = 'SUPERSEDED' AND NEW.status IN ('ARCHIVED'))
     ) THEN
    RAISE EXCEPTION 'Illegal policy version transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
