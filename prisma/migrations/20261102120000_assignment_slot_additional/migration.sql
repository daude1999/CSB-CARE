-- Carer places 3 and above (a visit may need any number of carers, not only one or two).
-- On its own so the new value is committed before the next migration uses it.
ALTER TYPE "AssignmentSlot" ADD VALUE IF NOT EXISTS 'ADDITIONAL';
