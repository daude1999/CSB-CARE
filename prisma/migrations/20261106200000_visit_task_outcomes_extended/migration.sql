-- Visit task outcomes from the AI CSB Coordinator brief (6 Nov 2026): a carer can also record that a task could not
-- be completed, did not apply at this visit, or that they identified a concern. Additive only: existing rows keep
-- DONE, NOT_DONE and REFUSED.
ALTER TYPE "TaskOutcome" ADD VALUE IF NOT EXISTS 'UNABLE';
ALTER TYPE "TaskOutcome" ADD VALUE IF NOT EXISTS 'NOT_APPLICABLE';
ALTER TYPE "TaskOutcome" ADD VALUE IF NOT EXISTS 'CONCERN';
