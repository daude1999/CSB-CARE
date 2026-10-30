-- V1: explicit branch grants per membership. No grants = every branch (single-branch default).
CREATE TABLE "MembershipBranch" (
  "membershipId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "grantedById" TEXT,
  CONSTRAINT "MembershipBranch_pkey" PRIMARY KEY ("membershipId", "branchId")
);
ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
