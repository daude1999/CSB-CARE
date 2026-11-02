-- HR & Workforce can now mark an employee as suspended. Additive: existing rows keep their status, and the value is
-- only ever written by the HR projection (src/server/workforce/projection.ts).
ALTER TYPE "EmploymentStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED' BEFORE 'ARCHIVED';
