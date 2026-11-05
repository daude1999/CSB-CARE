-- Forms PR 1: explicit links from a policy or procedure (optionally one of its sections, such as a procedure step) to
-- a form, template, checklist or tool. Additive only: nothing existing is changed or deleted.
CREATE TABLE "PolicyResourceLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "policyId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "sectionKey" TEXT,
    "useWhen" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "origin" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnById" TEXT,
    "withdrawReason" TEXT,

    CONSTRAINT "PolicyResourceLink_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PolicyResourceLink_origin_check" CHECK ("origin" IN ('BACKFILL_RELATED_TEXT', 'TEMPLATE', 'MANUAL')),
    CONSTRAINT "PolicyResourceLink_not_self" CHECK ("policyId" <> "resourceId"),
    CONSTRAINT "PolicyResourceLink_useWhen_length" CHECK ("useWhen" IS NULL OR length("useWhen") <= 300),
    CONSTRAINT "PolicyResourceLink_withdrawn_check" CHECK ("withdrawnAt" IS NOT NULL OR ("withdrawnById" IS NULL AND "withdrawReason" IS NULL))
);

CREATE INDEX "PolicyResourceLink_policyId_idx" ON "PolicyResourceLink"("policyId");
CREATE INDEX "PolicyResourceLink_resourceId_idx" ON "PolicyResourceLink"("resourceId");
CREATE INDEX "PolicyResourceLink_organisationId_idx" ON "PolicyResourceLink"("organisationId");
-- One active link per policy, resource and placement.
CREATE UNIQUE INDEX "PolicyResourceLink_active_key" ON "PolicyResourceLink"("policyId", "resourceId", COALESCE("sectionKey", '')) WHERE "withdrawnAt" IS NULL;

ALTER TABLE "PolicyResourceLink" ADD CONSTRAINT "PolicyResourceLink_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PolicyResourceLink" ADD CONSTRAINT "PolicyResourceLink_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity: both ends in the link's own organisation (or both CSB masters), the far end is a resource document and
-- the near end a policy, procedure or guidance. After creation only a one-way withdrawal is allowed.
CREATE OR REPLACE FUNCTION csb_policy_resource_link_guard() RETURNS trigger AS $$
DECLARE
  pol RECORD;
  res RECORD;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."withdrawnAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A withdrawn resource link cannot be changed';
    END IF;
    IF NEW."withdrawnAt" IS NULL
       OR NEW."organisationId" IS DISTINCT FROM OLD."organisationId" OR NEW."policyId" <> OLD."policyId"
       OR NEW."resourceId" <> OLD."resourceId" OR NEW."sectionKey" IS DISTINCT FROM OLD."sectionKey"
       OR NEW."useWhen" IS DISTINCT FROM OLD."useWhen" OR NEW."required" <> OLD."required"
       OR NEW."sortOrder" <> OLD."sortOrder" OR NEW."origin" <> OLD."origin"
       OR NEW."createdById" IS DISTINCT FROM OLD."createdById" OR NEW."createdAt" <> OLD."createdAt" THEN
      RAISE EXCEPTION 'A resource link can only be withdrawn, not edited';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "organisationId", "docType" INTO pol FROM "Policy" WHERE id = NEW."policyId";
  SELECT "organisationId", "docType" INTO res FROM "Policy" WHERE id = NEW."resourceId";
  IF pol."organisationId" IS DISTINCT FROM NEW."organisationId" OR res."organisationId" IS DISTINCT FROM NEW."organisationId" THEN
    RAISE EXCEPTION 'A policy can only be linked to resources of the same organisation';
  END IF;
  IF pol."docType" NOT IN ('POLICY', 'PROCEDURE', 'GUIDANCE') THEN
    RAISE EXCEPTION 'Only a policy, procedure or guidance document can link to a resource';
  END IF;
  IF res."docType" IN ('POLICY', 'PROCEDURE', 'GUIDANCE') THEN
    RAISE EXCEPTION 'The linked document must be a form, template, checklist or tool';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER policy_resource_link_guard BEFORE INSERT OR UPDATE ON "PolicyResourceLink"
  FOR EACH ROW EXECUTE FUNCTION csb_policy_resource_link_guard();

-- Backfill: the references each published resource already names in its "Related policies" section (key 'related'),
-- matched to a policy with that reference in the same organisation (or among CSB masters). Idempotent: a pair that
-- already has a link, active or withdrawn, is skipped, so an organisation's withdrawal is never undone. The seed
-- calls it again after loading the library.
CREATE OR REPLACE FUNCTION csb_backfill_policy_resource_links() RETURNS integer AS $$
DECLARE
  n integer;
BEGIN
  WITH refs AS (
    SELECT DISTINCT r.id AS resource_id, r."organisationId" AS org, m[1] AS ref
    FROM "Policy" r
    JOIN "PolicySection" s ON s."versionId" = r."currentPublishedVersionId" AND s.key = 'related'
    CROSS JOIN LATERAL regexp_matches(s.body, '(CSB-[A-Z]+-[0-9]+)', 'g') AS m
    WHERE r."docType" NOT IN ('POLICY', 'PROCEDURE', 'GUIDANCE')
  ), ins AS (
    INSERT INTO "PolicyResourceLink" ("id", "organisationId", "policyId", "resourceId", "origin")
    SELECT 'prl' || substr(md5(p.id || ':' || refs.resource_id), 1, 22), refs.org, p.id, refs.resource_id, 'BACKFILL_RELATED_TEXT'
    FROM refs
    JOIN "Policy" p ON p.ref = refs.ref AND p."organisationId" IS NOT DISTINCT FROM refs.org
     AND p.id <> refs.resource_id AND p."docType" IN ('POLICY', 'PROCEDURE', 'GUIDANCE')
    WHERE NOT EXISTS (SELECT 1 FROM "PolicyResourceLink" l WHERE l."policyId" = p.id AND l."resourceId" = refs.resource_id)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

SELECT csb_backfill_policy_resource_links();
