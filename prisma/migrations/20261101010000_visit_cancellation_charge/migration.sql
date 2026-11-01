-- The office decides whether each cancellation is charged (owner, 1 Nov 2026). Null keeps the funder short-notice rule.
ALTER TABLE "Visit" ADD COLUMN "cancellationCharge" BOOLEAN;
