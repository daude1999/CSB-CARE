-- V1: audits keep who completed them and every answer ever recorded; nothing changes after completion.
ALTER TABLE "Audit" ADD COLUMN "completedById" TEXT;

CREATE TABLE "AuditAnswerEvent" (
  "id" TEXT NOT NULL,
  "auditId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "response" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditAnswerEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditAnswerEvent_auditId_questionId_createdAt_idx" ON "AuditAnswerEvent"("auditId", "questionId", "createdAt");
ALTER TABLE "AuditAnswerEvent" ADD CONSTRAINT "AuditAnswerEvent_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TRIGGER audit_answer_event_immutable BEFORE UPDATE OR DELETE ON "AuditAnswerEvent"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();

-- A completed audit is frozen: no edits, no deletion, and its answers cannot change.
CREATE OR REPLACE FUNCTION csb_audit_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'Audit % is completed and immutable (%)', OLD.id, TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_guard BEFORE UPDATE OR DELETE ON "Audit"
  FOR EACH ROW EXECUTE FUNCTION csb_audit_guard();

CREATE OR REPLACE FUNCTION csb_audit_answer_guard() RETURNS trigger AS $$
DECLARE a_status text;
BEGIN
  SELECT status INTO a_status FROM "Audit" WHERE id = COALESCE(NEW."auditId", OLD."auditId");
  IF a_status = 'COMPLETED' THEN
    RAISE EXCEPTION 'Answers of a completed audit are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_answer_guard BEFORE INSERT OR UPDATE OR DELETE ON "AuditAnswer"
  FOR EACH ROW EXECUTE FUNCTION csb_audit_answer_guard();
