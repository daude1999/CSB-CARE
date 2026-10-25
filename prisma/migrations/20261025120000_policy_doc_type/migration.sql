-- Document type lets the library hold procedures, forms, checklists, risk assessments and audit tools alongside policies.
ALTER TABLE "Policy" ADD COLUMN "docType" TEXT NOT NULL DEFAULT 'POLICY';
CREATE INDEX "Policy_docType_idx" ON "Policy"("docType");
