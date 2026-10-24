-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('NONE', 'PLATFORM_ADMIN', 'CONTENT_EDITOR', 'REGULATORY_REVIEWER');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('ORG_ADMIN', 'POLICY_AUTHOR', 'POLICY_REVIEWER', 'POLICY_APPROVER', 'COMPLIANCE_LEAD', 'STAFF');

-- CreateEnum
CREATE TYPE "SourceCategory" AS ENUM ('REGULATOR', 'LEGISLATION', 'GOVERNMENT_GUIDANCE', 'CLINICAL_GUIDANCE', 'WORKFORCE', 'BEST_PRACTICE', 'HEALTH_AND_SAFETY', 'DATA_PROTECTION', 'FOOD_SAFETY', 'NHS');

-- CreateEnum
CREATE TYPE "MonitoringMethod" AS ENUM ('GOVUK_CONTENT_API', 'GOVUK_SEARCH_API', 'ATOM_FEED', 'RSS_FEED', 'LEGISLATION_GOV_UK', 'HTML_PAGE', 'MANUAL');

-- CreateEnum
CREATE TYPE "MonitoringCoverage" AS ENUM ('AUTOMATED', 'PARTIAL', 'MANUAL_REVIEW_ONLY');

-- CreateEnum
CREATE TYPE "RetrievalStatus" AS ENUM ('NEVER_CHECKED', 'OK', 'DEGRADED', 'FAILING', 'DISABLED');

-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'RETRY', 'TEST');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ChangeClassification" AS ENUM ('NEW_DOCUMENT', 'POTENTIALLY_SUBSTANTIVE', 'EDITORIAL', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('NEWLY_DETECTED', 'AWAITING_CLASSIFICATION', 'POTENTIALLY_SUBSTANTIVE', 'EDITORIAL_OR_IMMATERIAL', 'UNDER_REVIEW', 'CONFIRMED_RELEVANT', 'CONFIRMED_NOT_APPLICABLE', 'IMPACT_ASSESSMENT_COMPLETED', 'POLICY_REVISION_REQUIRED', 'NO_POLICY_REVISION_REQUIRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CandidateReason" AS ENUM ('REQUIREMENT_LINK', 'SOURCE_LINK', 'TEXT_MATCH', 'CATEGORY_MATCH');

-- CreateEnum
CREATE TYPE "LegalStatus" AS ENUM ('LEGISLATION', 'STATUTORY_GUIDANCE', 'REGULATOR_GUIDANCE', 'ADVISORY_GUIDANCE', 'BEST_PRACTICE', 'INTERNAL_POLICY');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED', 'UNVERIFIED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "PolicyKind" AS ENUM ('MASTER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VersionOrigin" AS ENUM ('SEED', 'MANUAL', 'AI_REGULATORY_REVISION', 'MASTER_SYNC', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "Applicability" AS ENUM ('APPLIES', 'DOES_NOT_APPLY', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "AssessmentOutcome" AS ENUM ('REVISION_RECOMMENDED', 'NO_REVISION_NEEDED', 'UNCERTAIN', 'CONFLICT_REQUIRES_EXPERT');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('PROPOSED', 'CONFIRMED_REVISION_REQUIRED', 'CONFIRMED_NO_REVISION', 'DISMISSED');

-- CreateEnum
CREATE TYPE "RevisionKind" AS ENUM ('REGULATORY', 'MASTER_SYNC', 'MANUAL', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('APPROVE', 'REQUEST_CHANGES', 'REJECT');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('SCHEDULED', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "platformRoles" "PlatformRole"[] DEFAULT ARRAY[]::"PlatformRole"[],
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'ENG',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceType" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'ENG',

    CONSTRAINT "ServiceType_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "cqcLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchServiceType" (
    "branchId" TEXT NOT NULL,
    "serviceTypeCode" TEXT NOT NULL,

    CONSTRAINT "BranchServiceType_pkey" PRIMARY KEY ("branchId","serviceTypeCode")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "branchId" TEXT,
    "roles" "OrgRole"[],
    "jobTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatorySource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "category" "SourceCategory" NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'ENG',
    "serviceTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "monitoringMethod" "MonitoringMethod" NOT NULL,
    "coverage" "MonitoringCoverage" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "frequencyMinutes" INTEGER NOT NULL DEFAULT 1440,
    "freshnessWindowHours" INTEGER NOT NULL DEFAULT 48,
    "lastAttemptedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastContentCheckedAt" TIMESTAMP(3),
    "lastChangeDetectedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "retrievalStatus" "RetrievalStatus" NOT NULL DEFAULT 'NEVER_CHECKED',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "currentContentHash" TEXT,
    "latestPublishedAt" TIMESTAMP(3),
    "latestModifiedAt" TIMESTAMP(3),
    "licence" TEXT,
    "reuseNotes" TEXT,
    "monitoringNotes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatorySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "documentType" TEXT,
    "legalStatus" "LegalStatus" NOT NULL DEFAULT 'ADVISORY_GUIDANCE',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentVersionId" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "normalisedText" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "rawStorageKey" TEXT,
    "contentType" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "modifiedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "runId" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRetrievalRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "jobId" TEXT,
    "trigger" "RunTrigger" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "documentsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "documentsChecked" INTEGER NOT NULL DEFAULT 0,
    "documentsNew" INTEGER NOT NULL DEFAULT 0,
    "documentsChanged" INTEGER NOT NULL DEFAULT 0,
    "documentsFailed" INTEGER NOT NULL DEFAULT 0,
    "contentChecked" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,

    CONSTRAINT "SourceRetrievalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "sourceId" TEXT,
    "level" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryChange" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "previousVersionId" TEXT,
    "newVersionId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "officialDate" TIMESTAMP(3),
    "classification" "ChangeClassification" NOT NULL,
    "classificationBasis" TEXT NOT NULL,
    "status" "ChangeStatus" NOT NULL DEFAULT 'NEWLY_DETECTED',
    "changedSections" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "suggestedUrgency" "Urgency" NOT NULL DEFAULT 'MEDIUM',
    "affectedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "affectedServiceTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "affectedRequirementIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiAnalysis" JSONB,
    "aiProvider" TEXT,
    "aiIsSimulated" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "uncertainty" TEXT,
    "reviewerId" TEXT,
    "reviewNotes" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatoryChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeStatusEvent" (
    "id" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "from" "ChangeStatus",
    "to" "ChangeStatus" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangePolicyCandidate" (
    "id" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "organisationId" TEXT,
    "reason" "CandidateReason" NOT NULL,
    "requirementId" TEXT NOT NULL DEFAULT '',
    "sectionKey" TEXT,
    "evidence" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangePolicyCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryRequirement" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'ENG',
    "title" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "exactReference" TEXT NOT NULL,
    "sourceSectionRef" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "legalStatus" "LegalStatus" NOT NULL,
    "serviceTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applicabilityNotes" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "effectiveDateVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastVerifiedAt" TIMESTAMP(3),
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "reviewStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatoryRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementVersion" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementPolicyLink" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "sectionKey" TEXT,
    "rationale" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementPolicyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyCategory" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "PolicyCategory_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "kind" "PolicyKind" NOT NULL,
    "organisationId" TEXT,
    "branchId" TEXT,
    "templateId" TEXT,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "serviceTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "jurisdiction" TEXT NOT NULL DEFAULT 'ENG',
    "status" "PolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT,
    "reviewerId" TEXT,
    "approverId" TEXT,
    "reviewIntervalMonths" INTEGER NOT NULL DEFAULT 12,
    "nextReviewDate" TIMESTAMP(3),
    "currentPublishedVersionId" TEXT,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "supportingSourceDocumentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "search_vector" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "organisationId" TEXT,
    "versionNumber" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "VersionOrigin" NOT NULL,
    "previousVersionId" TEXT,
    "basedOnMasterVersionId" TEXT,
    "changeSummary" TEXT,
    "reasonForChange" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdById" TEXT,
    "contentHash" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicySection" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isLocal" BOOLEAN NOT NULL DEFAULT false,
    "masterKey" TEXT,

    CONSTRAINT "PolicySection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactAssessment" (
    "id" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "organisationId" TEXT,
    "policyVersionId" TEXT NOT NULL,
    "applicability" "Applicability" NOT NULL,
    "outcome" "AssessmentOutcome" NOT NULL,
    "urgency" "Urgency" NOT NULL,
    "rationale" TEXT NOT NULL,
    "needsVerification" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "affectedSectionKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiOutput" JSONB,
    "provider" TEXT NOT NULL,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'PROPOSED',
    "reviewerId" TEXT,
    "reviewerReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRevision" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "organisationId" TEXT,
    "kind" "RevisionKind" NOT NULL,
    "impactAssessmentId" TEXT,
    "baseVersionId" TEXT,
    "draftVersionId" TEXT NOT NULL,
    "urgency" "Urgency" NOT NULL DEFAULT 'MEDIUM',
    "substantive" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT NOT NULL,
    "explanation" TEXT,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "edits" JSONB NOT NULL DEFAULT '[]',
    "provider" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewAssignment" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "deciderId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "decision" "Decision" NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionComment" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "sectionKey" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevisionComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCitation" (
    "id" TEXT NOT NULL,
    "changeId" TEXT,
    "impactAssessmentId" TEXT,
    "revisionId" TEXT,
    "assistantQueryId" TEXT,
    "sourceVersionId" TEXT,
    "policyVersionId" TEXT,
    "sectionRef" TEXT,
    "supportsSectionKey" TEXT,
    "quote" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "verificationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyPublication" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "organisationId" TEXT,
    "versionId" TEXT NOT NULL,
    "status" "PublicationStatus" NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "publishedById" TEXT NOT NULL,
    "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT true,
    "acknowledgementDueAt" TIMESTAMP(3),
    "implementationConfirmedAt" TIMESTAMP(3),
    "implementationConfirmedById" TEXT,
    "implementationNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Acknowledgement" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Acknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditTemplate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditQuestion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "guidance" TEXT,
    "position" INTEGER NOT NULL,
    "policyId" TEXT,

    CONSTRAINT "AuditQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditQuestionRequirement" (
    "questionId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,

    CONSTRAINT "AuditQuestionRequirement_pkey" PRIMARY KEY ("questionId","requirementId")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "branchId" TEXT,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "conductedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditAnswer" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "AuditAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditFinding" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "questionId" TEXT,
    "description" TEXT NOT NULL,
    "riskRating" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceAction" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "findingId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completionNote" TEXT,
    "completionEvidenceId" TEXT,
    "completedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionEvent" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "from" TEXT,
    "to" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceDocument" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "description" TEXT,
    "linkedType" TEXT,
    "linkedId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "retainUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingRequirement" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "renewalMonths" INTEGER,

    CONSTRAINT "TrainingRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingRequirementLink" (
    "trainingId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,

    CONSTRAINT "TrainingRequirementLink_pkey" PRIMARY KEY ("trainingId","requirementId")
);

-- CreateTable
CREATE TABLE "TrainingRecord" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trainingId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "evidenceId" TEXT,

    CONSTRAINT "TrainingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "links" JSONB NOT NULL DEFAULT '[]',
    "actionUrl" TEXT,
    "dueAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "kind" TEXT NOT NULL,
    "sourceVersionId" TEXT,
    "policyVersionId" TEXT,
    "policyId" TEXT,
    "sectionRef" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "legalStatus" "LegalStatus" NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "search_vector" tsvector,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantQuery" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_key_createdAt_idx" ON "LoginAttempt"("key", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");

-- CreateIndex
CREATE INDEX "Branch_organisationId_idx" ON "Branch"("organisationId");

-- CreateIndex
CREATE INDEX "Membership_organisationId_idx" ON "Membership"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organisationId_key" ON "Membership"("userId", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatorySource_key_key" ON "RegulatorySource"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_currentVersionId_key" ON "SourceDocument"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_sourceId_externalId_key" ON "SourceDocument"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "SourceVersion_documentId_contentHash_idx" ON "SourceVersion"("documentId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "SourceVersion_documentId_versionNumber_key" ON "SourceVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "SourceRetrievalRun_sourceId_startedAt_idx" ON "SourceRetrievalRun"("sourceId", "startedAt");

-- CreateIndex
CREATE INDEX "ProcessingEvent_runId_idx" ON "ProcessingEvent"("runId");

-- CreateIndex
CREATE INDEX "ProcessingEvent_sourceId_createdAt_idx" ON "ProcessingEvent"("sourceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryChange_newVersionId_key" ON "RegulatoryChange"("newVersionId");

-- CreateIndex
CREATE INDEX "RegulatoryChange_status_idx" ON "RegulatoryChange"("status");

-- CreateIndex
CREATE INDEX "RegulatoryChange_sourceId_idx" ON "RegulatoryChange"("sourceId");

-- CreateIndex
CREATE INDEX "ChangePolicyCandidate_organisationId_idx" ON "ChangePolicyCandidate"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChangePolicyCandidate_changeId_policyId_reason_requirementI_key" ON "ChangePolicyCandidate"("changeId", "policyId", "reason", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryRequirement_ref_key" ON "RegulatoryRequirement"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementVersion_requirementId_version_key" ON "RequirementVersion"("requirementId", "version");

-- CreateIndex
CREATE INDEX "RequirementPolicyLink_policyId_idx" ON "RequirementPolicyLink"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementPolicyLink_requirementId_policyId_sectionKey_key" ON "RequirementPolicyLink"("requirementId", "policyId", "sectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_currentPublishedVersionId_key" ON "Policy"("currentPublishedVersionId");

-- CreateIndex
CREATE INDEX "policy_search_idx" ON "Policy" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "Policy_organisationId_idx" ON "Policy"("organisationId");

-- CreateIndex
CREATE INDEX "Policy_templateId_idx" ON "Policy"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_organisationId_ref_key" ON "Policy"("organisationId", "ref");

-- CreateIndex
CREATE INDEX "PolicyVersion_organisationId_idx" ON "PolicyVersion"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_policyId_versionNumber_key" ON "PolicyVersion"("policyId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PolicySection_versionId_key_key" ON "PolicySection"("versionId", "key");

-- CreateIndex
CREATE INDEX "ImpactAssessment_organisationId_idx" ON "ImpactAssessment"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "ImpactAssessment_changeId_policyId_key" ON "ImpactAssessment"("changeId", "policyId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRevision_draftVersionId_key" ON "PolicyRevision"("draftVersionId");

-- CreateIndex
CREATE INDEX "PolicyRevision_organisationId_idx" ON "PolicyRevision"("organisationId");

-- CreateIndex
CREATE INDEX "PolicyRevision_policyId_idx" ON "PolicyRevision"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewAssignment_revisionId_assigneeId_role_key" ON "ReviewAssignment"("revisionId", "assigneeId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyPublication_versionId_key" ON "PolicyPublication"("versionId");

-- CreateIndex
CREATE INDEX "PolicyPublication_organisationId_idx" ON "PolicyPublication"("organisationId");

-- CreateIndex
CREATE INDEX "Acknowledgement_organisationId_acknowledgedAt_idx" ON "Acknowledgement"("organisationId", "acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Acknowledgement_publicationId_userId_key" ON "Acknowledgement"("publicationId", "userId");

-- CreateIndex
CREATE INDEX "AuditTemplate_organisationId_idx" ON "AuditTemplate"("organisationId");

-- CreateIndex
CREATE INDEX "Audit_organisationId_idx" ON "Audit"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditAnswer_auditId_questionId_key" ON "AuditAnswer"("auditId", "questionId");

-- CreateIndex
CREATE INDEX "ComplianceAction_organisationId_status_idx" ON "ComplianceAction"("organisationId", "status");

-- CreateIndex
CREATE INDEX "EvidenceDocument_organisationId_idx" ON "EvidenceDocument"("organisationId");

-- CreateIndex
CREATE INDEX "TrainingRecord_organisationId_idx" ON "TrainingRecord"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_channel_key" ON "NotificationDelivery"("notificationId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_idempotencyKey_key" ON "BackgroundJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_runAfter_idx" ON "BackgroundJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "BackgroundJob_type_createdAt_idx" ON "BackgroundJob"("type", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentChunk_organisationId_idx" ON "DocumentChunk"("organisationId");

-- CreateIndex
CREATE INDEX "document_chunk_search_idx" ON "DocumentChunk" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "DocumentChunk_sourceVersionId_idx" ON "DocumentChunk"("sourceVersionId");

-- CreateIndex
CREATE INDEX "DocumentChunk_policyVersionId_idx" ON "DocumentChunk"("policyVersionId");

-- CreateIndex
CREATE INDEX "AssistantQuery_organisationId_idx" ON "AssistantQuery"("organisationId");

-- CreateIndex
CREATE INDEX "AuditLog_organisationId_createdAt_idx" ON "AuditLog"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchServiceType" ADD CONSTRAINT "BranchServiceType_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchServiceType" ADD CONSTRAINT "BranchServiceType_serviceTypeCode_fkey" FOREIGN KEY ("serviceTypeCode") REFERENCES "ServiceType"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RegulatorySource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "SourceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceVersion" ADD CONSTRAINT "SourceVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceVersion" ADD CONSTRAINT "SourceVersion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SourceRetrievalRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRetrievalRun" ADD CONSTRAINT "SourceRetrievalRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RegulatorySource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingEvent" ADD CONSTRAINT "ProcessingEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SourceRetrievalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryChange" ADD CONSTRAINT "RegulatoryChange_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RegulatorySource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryChange" ADD CONSTRAINT "RegulatoryChange_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "SourceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryChange" ADD CONSTRAINT "RegulatoryChange_newVersionId_fkey" FOREIGN KEY ("newVersionId") REFERENCES "SourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeStatusEvent" ADD CONSTRAINT "ChangeStatusEvent_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "RegulatoryChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangePolicyCandidate" ADD CONSTRAINT "ChangePolicyCandidate_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "RegulatoryChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangePolicyCandidate" ADD CONSTRAINT "ChangePolicyCandidate_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryRequirement" ADD CONSTRAINT "RegulatoryRequirement_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RegulatorySource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryRequirement" ADD CONSTRAINT "RegulatoryRequirement_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementVersion" ADD CONSTRAINT "RequirementVersion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "RegulatoryRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementPolicyLink" ADD CONSTRAINT "RequirementPolicyLink_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "RegulatoryRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementPolicyLink" ADD CONSTRAINT "RequirementPolicyLink_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_categoryCode_fkey" FOREIGN KEY ("categoryCode") REFERENCES "PolicyCategory"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_currentPublishedVersionId_fkey" FOREIGN KEY ("currentPublishedVersionId") REFERENCES "PolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySection" ADD CONSTRAINT "PolicySection_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAssessment" ADD CONSTRAINT "ImpactAssessment_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "RegulatoryChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAssessment" ADD CONSTRAINT "ImpactAssessment_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_impactAssessmentId_fkey" FOREIGN KEY ("impactAssessmentId") REFERENCES "ImpactAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "PolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_draftVersionId_fkey" FOREIGN KEY ("draftVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PolicyRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PolicyRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionComment" ADD CONSTRAINT "RevisionComment_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PolicyRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCitation" ADD CONSTRAINT "AiCitation_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "RegulatoryChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCitation" ADD CONSTRAINT "AiCitation_impactAssessmentId_fkey" FOREIGN KEY ("impactAssessmentId") REFERENCES "ImpactAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCitation" ADD CONSTRAINT "AiCitation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PolicyRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCitation" ADD CONSTRAINT "AiCitation_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "SourceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyPublication" ADD CONSTRAINT "PolicyPublication_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyPublication" ADD CONSTRAINT "PolicyPublication_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acknowledgement" ADD CONSTRAINT "Acknowledgement_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "PolicyPublication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acknowledgement" ADD CONSTRAINT "Acknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestion" ADD CONSTRAINT "AuditQuestion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AuditTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestion" ADD CONSTRAINT "AuditQuestion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestionRequirement" ADD CONSTRAINT "AuditQuestionRequirement_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "AuditQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestionRequirement" ADD CONSTRAINT "AuditQuestionRequirement_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "RegulatoryRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AuditTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditAnswer" ADD CONSTRAINT "AuditAnswer_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditAnswer" ADD CONSTRAINT "AuditAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "AuditQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAction" ADD CONSTRAINT "ComplianceAction_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionEvent" ADD CONSTRAINT "ActionEvent_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "ComplianceAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRequirementLink" ADD CONSTRAINT "TrainingRequirementLink_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "TrainingRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRequirementLink" ADD CONSTRAINT "TrainingRequirementLink_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "RegulatoryRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "TrainingRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "SourceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

