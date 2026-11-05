-- Reference Numbers tab: additive columns on the existing external reference register.
-- No existing row changes: every current reference stays ACTIVE with its value, source and verification as they are.
ALTER TABLE "ServiceUserExternalReference"
  ADD COLUMN "systemLabel" TEXT,
  ADD COLUMN "sourceQuoteCipher" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "supersededAt" TIMESTAMP(3),
  ADD COLUMN "supersededByUserId" TEXT,
  ADD COLUMN "replacedById" TEXT,
  ADD COLUMN "supersedeReason" TEXT;
