-- Policy Reader: a person's own "important" and "reading list" markers on a policy. Additive only.
CREATE TABLE "PolicyBookmark" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyBookmark_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PolicyBookmark_kind_check" CHECK ("kind" IN ('IMPORTANT', 'READING_LIST'))
);

CREATE UNIQUE INDEX "PolicyBookmark_userId_policyId_kind_key" ON "PolicyBookmark"("userId", "policyId", "kind");
CREATE INDEX "PolicyBookmark_organisationId_userId_kind_idx" ON "PolicyBookmark"("organisationId", "userId", "kind");
