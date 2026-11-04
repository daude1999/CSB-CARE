-- Add a draft state to service-user risk assessments. Existing ACTIVE and
-- ARCHIVED records remain unchanged. Drafts must not appear on carer-facing lists.
ALTER TYPE "RecordStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
