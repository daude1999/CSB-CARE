-- Shared workforce identity, service users, care records, rostering, call monitoring and finance.
-- Additive only: new enums, tables, columns and indexes. No existing data is changed.

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ONBOARDING', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CarerGender" AS ENUM ('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "AbsenceKind" AS ENUM ('HOLIDAY', 'SICKNESS', 'COMPASSIONATE', 'TRAINING', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "AbsenceStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AvailabilityKind" AS ENUM ('AVAILABLE', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "ServiceUserStatus" AS ENUM ('ENQUIRY', 'ASSESSMENT', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "GenderPreference" AS ENUM ('ANY', 'FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('NEXT_OF_KIN', 'FAMILY', 'LPA_HEALTH', 'LPA_FINANCE', 'GP', 'PHARMACY', 'SOCIAL_WORKER', 'DISTRICT_NURSE', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceUserAbsenceReason" AS ENUM ('HOSPITAL', 'RESPITE', 'HOLIDAY', 'OTHER');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "CarePlanStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RiskType" AS ENUM ('ENVIRONMENT', 'MOVING_HANDLING', 'FALLS', 'PRESSURE_SKIN', 'MEDICATION_SUPPORT', 'NUTRITION', 'LONE_WORKING', 'OTHER');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'CLOSED');

-- CreateEnum
CREATE TYPE "ComplianceRule" AS ENUM ('BLOCK', 'REVIEW', 'IGNORE');

-- CreateEnum
CREATE TYPE "RotaType" AS ENUM ('NORMAL', 'ALTERNATE');

-- CreateEnum
CREATE TYPE "RotaBuildStatus" AS ENUM ('BUILT', 'DELETED');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'CANCELLED', 'NOT_DELIVERED');

-- CreateEnum
CREATE TYPE "AssignmentSlot" AS ENUM ('PRIMARY', 'SECOND', 'SHADOW');

-- CreateEnum
CREATE TYPE "TaskOutcome" AS ENUM ('DONE', 'NOT_DONE', 'REFUSED');

-- CreateEnum
CREATE TYPE "ClockKind" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "ClockMethod" AS ENUM ('APP', 'APP_QR', 'OFFICE');

-- CreateEnum
CREATE TYPE "RouteKind" AS ENUM ('CARER', 'AREA');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FunderKind" AS ENUM ('LOCAL_AUTHORITY', 'NHS', 'PRIVATE', 'OTHER');

-- CreateEnum
CREATE TYPE "TimeBasis" AS ENUM ('SCHEDULED', 'ACTUAL');

-- CreateEnum
CREATE TYPE "RateCardKind" AS ENUM ('CHARGE', 'PAY');

-- CreateEnum
CREATE TYPE "RateUnit" AS ENUM ('PER_HOUR', 'PER_VISIT');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RunStatusFinance" AS ENUM ('DRAFT', 'APPROVED', 'VOID');

-- CreateEnum
CREATE TYPE "PayLineKind" AS ENUM ('VISIT', 'MILEAGE', 'ADJUSTMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrgRole" ADD VALUE 'CARE_MANAGER';
ALTER TYPE "OrgRole" ADD VALUE 'CARE_COORDINATOR';
ALTER TYPE "OrgRole" ADD VALUE 'CARER';
ALTER TYPE "OrgRole" ADD VALUE 'FINANCE_OFFICER';

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "hrBranchKey" TEXT;

-- CreateTable
CREATE TABLE "StaffMember" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "hrEmployeeId" TEXT NOT NULL,
    "hrVersion" INTEGER NOT NULL,
    "hrHash" TEXT NOT NULL,
    "hrMissing" BOOLEAN NOT NULL DEFAULT false,
    "staffNumber" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "preferredName" TEXT,
    "jobTitle" TEXT NOT NULL,
    "employmentStatus" "EmploymentStatus" NOT NULL,
    "hrBranchKey" TEXT NOT NULL,
    "branchId" TEXT,
    "startDate" DATE,
    "leavingDate" DATE,
    "workEmail" TEXT,
    "workPhone" TEXT,
    "userId" TEXT,
    "linkedById" TEXT,
    "linkedAt" TIMESTAMP(3),
    "projectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCompliance" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "hrCheckId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "recurring" BOOLEAN NOT NULL,
    "dueDate" DATE,
    "verified" BOOLEAN NOT NULL,
    "hasEvidence" BOOLEAN NOT NULL,

    CONSTRAINT "StaffCompliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotaStaffProfile" (
    "staffId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "rotaEnabled" BOOLEAN,
    "gender" "CarerGender",
    "drives" BOOLEAN NOT NULL DEFAULT false,
    "maxWeeklyMinutes" INTEGER,
    "notes" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RotaStaffProfile_pkey" PRIMARY KEY ("staffId")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '#6b46c9',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffArea" (
    "staffId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,

    CONSTRAINT "StaffArea_pkey" PRIMARY KEY ("staffId","areaId")
);

-- CreateTable
CREATE TABLE "MembershipArea" (
    "membershipId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,

    CONSTRAINT "MembershipArea_pkey" PRIMARY KEY ("membershipId","areaId")
);

-- CreateTable
CREATE TABLE "StaffAbsence" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "kind" "AbsenceKind" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AbsenceStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "StaffAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAvailability" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "kind" "AvailabilityKind" NOT NULL DEFAULT 'AVAILABLE',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceUser" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "branchId" TEXT,
    "areaId" TEXT,
    "reference" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "preferredName" TEXT,
    "dateOfBirth" DATE,
    "gender" TEXT,
    "pronouns" TEXT,
    "nhsNumber" TEXT,
    "status" "ServiceUserStatus" NOT NULL DEFAULT 'ENQUIRY',
    "startDate" DATE,
    "endDate" DATE,
    "endReason" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "town" TEXT,
    "postcode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "accessNotes" TEXT,
    "keySafeCipher" TEXT,
    "keySafeUpdatedAt" TIMESTAMP(3),
    "carerGenderPreference" "GenderPreference" NOT NULL DEFAULT 'ANY',
    "firstLanguage" TEXT,
    "communicationNeeds" TEXT,
    "carePreferences" TEXT,
    "riskLevel" "RiskLevel",
    "riskSummary" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceUserContact" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "kind" "ContactKind" NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "canReceiveUpdates" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceUserContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceUserAbsence" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "reason" "ServiceUserAbsenceReason" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,

    CONSTRAINT "ServiceUserAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePackage" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "funderId" TEXT,
    "reference" TEXT,
    "commissionedMinutesPerWeek" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" "PackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "requirements" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarerPreference" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "rating" INTEGER,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarerPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePlan" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "CarePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT,
    "reviewDue" DATE,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "CarePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePlanSection" (
    "id" TEXT NOT NULL,
    "carePlanId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "outcomes" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "CarePlanSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePlanAcknowledgement" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "carePlanId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarePlanAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "type" "RiskType" NOT NULL,
    "title" TEXT NOT NULL,
    "hazards" TEXT NOT NULL,
    "controls" TEXT NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "reviewDue" DATE NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "assessedById" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "serviceUserId" TEXT,
    "staffId" TEXT,
    "visitId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "immediateAction" TEXT,
    "safeguarding" BOOLEAN NOT NULL DEFAULT false,
    "notifiable" BOOLEAN NOT NULL DEFAULT false,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "reportedById" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "investigatorId" TEXT,
    "outcome" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotaSettings" (
    "organisationId" TEXT NOT NULL,
    "cycleLength" INTEGER NOT NULL DEFAULT 4,
    "anchorMonday" DATE NOT NULL,
    "buildAheadWeeks" INTEGER NOT NULL DEFAULT 2,
    "lateAfterMin" INTEGER NOT NULL DEFAULT 10,
    "missedAfterMin" INTEGER NOT NULL DEFAULT 30,
    "earlyBeforeMin" INTEGER NOT NULL DEFAULT 10,
    "blockEarlyClockIn" BOOLEAN NOT NULL DEFAULT false,
    "shortVisitPercent" INTEGER NOT NULL DEFAULT 75,
    "requireNoteOnShortVisit" BOOLEAN NOT NULL DEFAULT true,
    "dbsRule" "ComplianceRule" NOT NULL DEFAULT 'BLOCK',
    "rightToWorkRule" "ComplianceRule" NOT NULL DEFAULT 'BLOCK',
    "trainingRule" "ComplianceRule" NOT NULL DEFAULT 'REVIEW',
    "careRoleTitles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minPreferenceRating" INTEGER,
    "geofenceMetres" INTEGER NOT NULL DEFAULT 150,
    "carerDaysForward" INTEGER NOT NULL DEFAULT 7,
    "carerDaysBack" INTEGER NOT NULL DEFAULT 1,
    "mandatoryClockOutNote" BOOLEAN NOT NULL DEFAULT false,
    "doorstepCancel" BOOLEAN NOT NULL DEFAULT true,
    "alertLatencyTargetSec" INTEGER NOT NULL DEFAULT 300,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RotaSettings_pkey" PRIMARY KEY ("organisationId")
);

-- CreateTable
CREATE TABLE "CallType" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultDurationMin" INTEGER NOT NULL DEFAULT 30,
    "monitored" BOOLEAN NOT NULL DEFAULT true,
    "chargeable" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CallType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareTask" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CareTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitTemplate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "callTypeId" TEXT NOT NULL,
    "areaId" TEXT,
    "cycleWeeks" INTEGER[],
    "weekdays" INTEGER[],
    "startMinute" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "carersRequired" INTEGER NOT NULL DEFAULT 1,
    "preferredStaff1Id" TEXT,
    "preferredStaff2Id" TEXT,
    "shadowStaffId" TEXT,
    "timeLocked" BOOLEAN NOT NULL DEFAULT false,
    "medicationRequired" BOOLEAN NOT NULL DEFAULT false,
    "alertOnLate" BOOLEAN NOT NULL DEFAULT true,
    "rotaType" "RotaType" NOT NULL DEFAULT 'NORMAL',
    "runRouteTemplateId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateTask" (
    "templateId" TEXT NOT NULL,
    "careTaskId" TEXT NOT NULL,

    CONSTRAINT "TemplateTask_pkey" PRIMARY KEY ("templateId","careTaskId")
);

-- CreateTable
CREATE TABLE "RotaBuild" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "cycleWeek" INTEGER NOT NULL,
    "areaIds" TEXT[],
    "status" "RotaBuildStatus" NOT NULL DEFAULT 'BUILT',
    "builtById" TEXT NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visitCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "unassignedSlots" INTEGER NOT NULL,
    "forecastMinutes" INTEGER NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "deletedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RotaBuild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "callTypeId" TEXT NOT NULL,
    "areaId" TEXT,
    "templateId" TEXT,
    "rotaBuildId" TEXT,
    "runRouteId" TEXT,
    "runOrder" INTEGER,
    "date" DATE NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "carersRequired" INTEGER NOT NULL DEFAULT 1,
    "status" "VisitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "notDeliveredReason" TEXT,
    "rotaType" "RotaType" NOT NULL DEFAULT 'NORMAL',
    "timeLocked" BOOLEAN NOT NULL DEFAULT false,
    "medicationRequired" BOOLEAN NOT NULL DEFAULT false,
    "alertOnLate" BOOLEAN NOT NULL DEFAULT true,
    "chargeable" BOOLEAN NOT NULL DEFAULT true,
    "payable" BOOLEAN NOT NULL DEFAULT true,
    "manuallyChanged" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "notes" TEXT,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitAssignment" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "slot" "AssignmentSlot" NOT NULL,
    "staffId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "eligibility" TEXT NOT NULL,
    "warningsAccepted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removeReason" TEXT,
    "reviewReason" TEXT,
    "reviewFlaggedAt" TIMESTAMP(3),

    CONSTRAINT "VisitAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitTask" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "careTaskId" TEXT,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "VisitTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitTaskOutcome" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "visitTaskId" TEXT NOT NULL,
    "outcome" "TaskOutcome" NOT NULL,
    "note" TEXT,
    "staffId" TEXT,
    "recordedById" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitTaskOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitClock" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "staffId" TEXT,
    "kind" "ClockKind" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "method" "ClockMethod" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "nonce" TEXT,
    "recordedById" TEXT NOT NULL,
    "reason" TEXT,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitClock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitNote" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "staffId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "VisitStatus",
    "toStatus" "VisitStatus",
    "actorId" TEXT,
    "reason" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunRouteTemplate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "RouteKind" NOT NULL DEFAULT 'CARER',
    "staffId" TEXT,
    "areaId" TEXT,
    "colour" TEXT NOT NULL DEFAULT '#6b46c9',
    "textColour" TEXT NOT NULL DEFAULT '#ffffff',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunRouteTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunRoute" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "RouteKind" NOT NULL DEFAULT 'CARER',
    "staffId" TEXT,
    "areaId" TEXT,
    "weekStart" DATE NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '#6b46c9',
    "textColour" TEXT NOT NULL DEFAULT '#ffffff',
    "templateId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotaAlert" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "visitId" TEXT,
    "staffId" TEXT,
    "assignmentId" TEXT,
    "message" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conditionAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,

    CONSTRAINT "RotaAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotaProcessingRun" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "alertsRaised" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "RotaProcessingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Funder" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FunderKind" NOT NULL,
    "reference" TEXT,
    "billingEmail" TEXT,
    "billingAddress" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "chargeBasis" "TimeBasis" NOT NULL DEFAULT 'SCHEDULED',
    "chargeRateCardId" TEXT,
    "shortNoticeCancelHours" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Funder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCard" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" "RateCardKind" NOT NULL,
    "name" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateBand" (
    "id" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "fromMinute" INTEGER NOT NULL DEFAULT 0,
    "toMinute" INTEGER NOT NULL DEFAULT 1440,
    "bankHoliday" BOOLEAN NOT NULL DEFAULT false,
    "ratePence" INTEGER NOT NULL,
    "unit" "RateUnit" NOT NULL DEFAULT 'PER_HOUR',
    "minimumMinutes" INTEGER,

    CONSTRAINT "RateBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankHoliday" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "BankHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffPayRate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,

    CONSTRAINT "StaffPayRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceSettings" (
    "organisationId" TEXT NOT NULL,
    "defaultPayRateCardId" TEXT,
    "payBasis" "TimeBasis" NOT NULL DEFAULT 'ACTUAL',
    "mileagePencePerMile" INTEGER NOT NULL DEFAULT 45,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "nextInvoiceNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceSettings_pkey" PRIMARY KEY ("organisationId")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledMinutes" INTEGER NOT NULL DEFAULT 0,
    "deliveredMinutes" INTEGER NOT NULL DEFAULT 0,
    "payableMinutes" INTEGER NOT NULL DEFAULT 0,
    "exceptions" INTEGER NOT NULL DEFAULT 0,
    "mileageMiles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetLine" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "visitId" TEXT,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "scheduledMinutes" INTEGER NOT NULL,
    "deliveredMinutes" INTEGER NOT NULL,
    "payableMinutes" INTEGER NOT NULL,
    "exception" TEXT,

    CONSTRAINT "TimesheetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MileageClaim" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "visitId" TEXT,
    "date" DATE NOT NULL,
    "miles" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "status" "ClaimStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "MileageClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceRun" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "RunStatusFinance" NOT NULL DEFAULT 'DRAFT',
    "totalPence" INTEGER NOT NULL DEFAULT 0,
    "exceptions" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "InvoiceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "funderId" TEXT NOT NULL,
    "number" TEXT,
    "totalPence" INTEGER NOT NULL,
    "dueDays" INTEGER NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "visitId" TEXT,
    "serviceUserId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "ratePence" INTEGER NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "bandLabel" TEXT NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRun" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "RunStatusFinance" NOT NULL DEFAULT 'DRAFT',
    "totalPence" INTEGER NOT NULL DEFAULT 0,
    "exceptions" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "visitId" TEXT,
    "kind" "PayLineKind" NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "ratePence" INTEGER NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "bandLabel" TEXT NOT NULL,

    CONSTRAINT "PayLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffMember_organisationId_employmentStatus_idx" ON "StaffMember"("organisationId", "employmentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_organisationId_hrEmployeeId_key" ON "StaffMember"("organisationId", "hrEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_organisationId_userId_key" ON "StaffMember"("organisationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_id_organisationId_key" ON "StaffMember"("id", "organisationId");

-- CreateIndex
CREATE INDEX "StaffCompliance_organisationId_idx" ON "StaffCompliance"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCompliance_staffId_hrCheckId_key" ON "StaffCompliance"("staffId", "hrCheckId");

-- CreateIndex
CREATE UNIQUE INDEX "Area_organisationId_name_key" ON "Area"("organisationId", "name");

-- CreateIndex
CREATE INDEX "StaffAbsence_organisationId_staffId_startsAt_idx" ON "StaffAbsence"("organisationId", "staffId", "startsAt");

-- CreateIndex
CREATE INDEX "StaffAvailability_organisationId_staffId_idx" ON "StaffAvailability"("organisationId", "staffId");

-- CreateIndex
CREATE INDEX "ServiceUser_organisationId_status_idx" ON "ServiceUser"("organisationId", "status");

-- CreateIndex
CREATE INDEX "ServiceUser_organisationId_lastName_idx" ON "ServiceUser"("organisationId", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUser_organisationId_reference_key" ON "ServiceUser"("organisationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUser_id_organisationId_key" ON "ServiceUser"("id", "organisationId");

-- CreateIndex
CREATE INDEX "ServiceUserContact_serviceUserId_idx" ON "ServiceUserContact"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserAbsence_organisationId_serviceUserId_startsAt_idx" ON "ServiceUserAbsence"("organisationId", "serviceUserId", "startsAt");

-- CreateIndex
CREATE INDEX "CarePackage_organisationId_serviceUserId_idx" ON "CarePackage"("organisationId", "serviceUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CarerPreference_serviceUserId_staffId_key" ON "CarerPreference"("serviceUserId", "staffId");

-- CreateIndex
CREATE INDEX "CarePlan_organisationId_status_idx" ON "CarePlan"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CarePlan_serviceUserId_version_key" ON "CarePlan"("serviceUserId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CarePlanSection_carePlanId_key_key" ON "CarePlanSection"("carePlanId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CarePlanAcknowledgement_carePlanId_staffId_key" ON "CarePlanAcknowledgement"("carePlanId", "staffId");

-- CreateIndex
CREATE INDEX "RiskAssessment_organisationId_serviceUserId_idx" ON "RiskAssessment"("organisationId", "serviceUserId");

-- CreateIndex
CREATE INDEX "Incident_organisationId_status_idx" ON "Incident"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_organisationId_reference_key" ON "Incident"("organisationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "CallType_organisationId_name_key" ON "CallType"("organisationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CareTask_organisationId_name_key" ON "CareTask"("organisationId", "name");

-- CreateIndex
CREATE INDEX "VisitTemplate_organisationId_serviceUserId_idx" ON "VisitTemplate"("organisationId", "serviceUserId");

-- CreateIndex
CREATE INDEX "VisitTemplate_organisationId_enabled_idx" ON "VisitTemplate"("organisationId", "enabled");

-- CreateIndex
CREATE INDEX "RotaBuild_organisationId_weekStart_idx" ON "RotaBuild"("organisationId", "weekStart");

-- CreateIndex
CREATE INDEX "Visit_organisationId_date_idx" ON "Visit"("organisationId", "date");

-- CreateIndex
CREATE INDEX "Visit_organisationId_status_date_idx" ON "Visit"("organisationId", "status", "date");

-- CreateIndex
CREATE INDEX "Visit_serviceUserId_date_idx" ON "Visit"("serviceUserId", "date");

-- CreateIndex
CREATE INDEX "Visit_templateId_date_idx" ON "Visit"("templateId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_organisationId_reference_key" ON "Visit"("organisationId", "reference");

-- CreateIndex
CREATE INDEX "VisitAssignment_organisationId_staffId_startsAt_idx" ON "VisitAssignment"("organisationId", "staffId", "startsAt");

-- CreateIndex
CREATE INDEX "VisitAssignment_visitId_idx" ON "VisitAssignment"("visitId");

-- CreateIndex
CREATE INDEX "VisitTask_visitId_idx" ON "VisitTask"("visitId");

-- CreateIndex
CREATE INDEX "VisitTaskOutcome_visitId_idx" ON "VisitTaskOutcome"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitClock_nonce_key" ON "VisitClock"("nonce");

-- CreateIndex
CREATE INDEX "VisitClock_visitId_idx" ON "VisitClock"("visitId");

-- CreateIndex
CREATE INDEX "VisitNote_visitId_idx" ON "VisitNote"("visitId");

-- CreateIndex
CREATE INDEX "VisitEvent_visitId_createdAt_idx" ON "VisitEvent"("visitId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RunRouteTemplate_organisationId_name_key" ON "RunRouteTemplate"("organisationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RunRoute_organisationId_weekStart_name_key" ON "RunRoute"("organisationId", "weekStart", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RotaAlert_dedupeKey_key" ON "RotaAlert"("dedupeKey");

-- CreateIndex
CREATE INDEX "RotaAlert_organisationId_resolvedAt_idx" ON "RotaAlert"("organisationId", "resolvedAt");

-- CreateIndex
CREATE INDEX "RotaProcessingRun_kind_startedAt_idx" ON "RotaProcessingRun"("kind", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Funder_organisationId_name_key" ON "Funder"("organisationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RateCard_organisationId_name_key" ON "RateCard"("organisationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BankHoliday_organisationId_date_key" ON "BankHoliday"("organisationId", "date");

-- CreateIndex
CREATE INDEX "StaffPayRate_organisationId_staffId_idx" ON "StaffPayRate"("organisationId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_organisationId_staffId_periodStart_periodEnd_key" ON "Timesheet"("organisationId", "staffId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "MileageClaim_organisationId_staffId_date_idx" ON "MileageClaim"("organisationId", "staffId", "date");

-- CreateIndex
CREATE INDEX "InvoiceRun_organisationId_periodStart_idx" ON "InvoiceRun"("organisationId", "periodStart");

-- CreateIndex
CREATE INDEX "PayRun_organisationId_periodStart_idx" ON "PayRun"("organisationId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_organisationId_hrBranchKey_key" ON "Branch"("organisationId", "hrBranchKey");

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCompliance" ADD CONSTRAINT "StaffCompliance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotaStaffProfile" ADD CONSTRAINT "RotaStaffProfile_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffArea" ADD CONSTRAINT "StaffArea_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffArea" ADD CONSTRAINT "StaffArea_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipArea" ADD CONSTRAINT "MembershipArea_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipArea" ADD CONSTRAINT "MembershipArea_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAbsence" ADD CONSTRAINT "StaffAbsence_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAvailability" ADD CONSTRAINT "StaffAvailability_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceUser" ADD CONSTRAINT "ServiceUser_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceUser" ADD CONSTRAINT "ServiceUser_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceUser" ADD CONSTRAINT "ServiceUser_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceUserContact" ADD CONSTRAINT "ServiceUserContact_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceUserAbsence" ADD CONSTRAINT "ServiceUserAbsence_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePackage" ADD CONSTRAINT "CarePackage_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePackage" ADD CONSTRAINT "CarePackage_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarerPreference" ADD CONSTRAINT "CarerPreference_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarerPreference" ADD CONSTRAINT "CarerPreference_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePlan" ADD CONSTRAINT "CarePlan_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePlanSection" ADD CONSTRAINT "CarePlanSection_carePlanId_fkey" FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePlanAcknowledgement" ADD CONSTRAINT "CarePlanAcknowledgement_carePlanId_fkey" FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitTemplate" ADD CONSTRAINT "VisitTemplate_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitTemplate" ADD CONSTRAINT "VisitTemplate_callTypeId_fkey" FOREIGN KEY ("callTypeId") REFERENCES "CallType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateTask" ADD CONSTRAINT "TemplateTask_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "VisitTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateTask" ADD CONSTRAINT "TemplateTask_careTaskId_fkey" FOREIGN KEY ("careTaskId") REFERENCES "CareTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_callTypeId_fkey" FOREIGN KEY ("callTypeId") REFERENCES "CallType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "VisitTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_rotaBuildId_fkey" FOREIGN KEY ("rotaBuildId") REFERENCES "RotaBuild"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_runRouteId_fkey" FOREIGN KEY ("runRouteId") REFERENCES "RunRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitAssignment" ADD CONSTRAINT "VisitAssignment_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitAssignment" ADD CONSTRAINT "VisitAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitTask" ADD CONSTRAINT "VisitTask_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitTaskOutcome" ADD CONSTRAINT "VisitTaskOutcome_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitTaskOutcome" ADD CONSTRAINT "VisitTaskOutcome_visitTaskId_fkey" FOREIGN KEY ("visitTaskId") REFERENCES "VisitTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitClock" ADD CONSTRAINT "VisitClock_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitNote" ADD CONSTRAINT "VisitNote_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitEvent" ADD CONSTRAINT "VisitEvent_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Funder" ADD CONSTRAINT "Funder_chargeRateCardId_fkey" FOREIGN KEY ("chargeRateCardId") REFERENCES "RateCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateBand" ADD CONSTRAINT "RateBand_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPayRate" ADD CONSTRAINT "StaffPayRate_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPayRate" ADD CONSTRAINT "StaffPayRate_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetLine" ADD CONSTRAINT "TimesheetLine_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_runId_fkey" FOREIGN KEY ("runId") REFERENCES "InvoiceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayLine" ADD CONSTRAINT "PayLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───────────── Integrity rules Prisma cannot express ─────────────

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Value checks.
ALTER TABLE "VisitTemplate" ADD CONSTRAINT visit_template_values_chk CHECK (
  "startMinute" BETWEEN 0 AND 1439 AND "durationMin" BETWEEN 5 AND 1440 AND "carersRequired" IN (1, 2)
  AND cardinality("weekdays") > 0 AND "weekdays" <@ ARRAY[1,2,3,4,5,6,7]
  AND cardinality("cycleWeeks") > 0 AND "cycleWeeks" <@ ARRAY[1,2,3,4]
  AND ("preferredStaff2Id" IS NULL OR "preferredStaff1Id" IS NULL OR "preferredStaff1Id" <> "preferredStaff2Id"));
ALTER TABLE "Visit" ADD CONSTRAINT visit_values_chk CHECK ("scheduledEnd" > "scheduledStart" AND "carersRequired" IN (1, 2));
ALTER TABLE "RotaSettings" ADD CONSTRAINT rota_settings_values_chk CHECK ("cycleLength" BETWEEN 1 AND 4 AND "lateAfterMin" >= 0 AND "missedAfterMin" > "lateAfterMin" AND "shortVisitPercent" BETWEEN 1 AND 100);
ALTER TABLE "StaffAvailability" ADD CONSTRAINT staff_availability_values_chk CHECK ("weekday" BETWEEN 1 AND 7 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");
ALTER TABLE "StaffAbsence" ADD CONSTRAINT staff_absence_values_chk CHECK ("endsAt" > "startsAt");
ALTER TABLE "RateBand" ADD CONSTRAINT rate_band_values_chk CHECK ("ratePence" >= 0 AND "fromMinute" >= 0 AND "toMinute" <= 1440 AND "toMinute" > "fromMinute");
ALTER TABLE "CarerPreference" ADD CONSTRAINT carer_preference_rating_chk CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);

-- A template produces at most one visit per date: rebuilding a week can never duplicate visits.
CREATE UNIQUE INDEX visit_template_date_uniq ON "Visit" ("templateId", "date") WHERE "templateId" IS NOT NULL;

-- One live assignment per slot, and the same person never fills two slots of one visit.
CREATE UNIQUE INDEX visit_assignment_slot_uniq ON "VisitAssignment" ("visitId", "slot") WHERE "removedAt" IS NULL;
CREATE UNIQUE INDEX visit_assignment_staff_uniq ON "VisitAssignment" ("visitId", "staffId") WHERE "removedAt" IS NULL;

-- Assignments, visits and templates must stay inside one organisation.
CREATE OR REPLACE FUNCTION csb_visit_assignment_sync() RETURNS trigger AS $$
DECLARE v record; s_org text;
BEGIN
  SELECT "organisationId", "scheduledStart", "scheduledEnd", status INTO v FROM "Visit" WHERE id = NEW."visitId";
  SELECT "organisationId" INTO s_org FROM "StaffMember" WHERE id = NEW."staffId";
  IF v."organisationId" IS DISTINCT FROM NEW."organisationId" OR s_org IS DISTINCT FROM NEW."organisationId" THEN
    RAISE EXCEPTION 'VisitAssignment organisation must match its visit and staff member';
  END IF;
  NEW."startsAt" := v."scheduledStart";
  NEW."endsAt" := v."scheduledEnd";
  NEW."blocking" := NEW."removedAt" IS NULL AND v.status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER visit_assignment_sync BEFORE INSERT OR UPDATE ON "VisitAssignment"
  FOR EACH ROW EXECUTE FUNCTION csb_visit_assignment_sync();

-- No carer is ever double-booked: blocking assignments of one person may not overlap in time.
ALTER TABLE "VisitAssignment" ADD CONSTRAINT visit_assignment_no_overlap
  EXCLUDE USING gist ("staffId" WITH =, tsrange("startsAt", "endsAt") WITH &&) WHERE ("blocking");

CREATE OR REPLACE FUNCTION csb_visit_guard() RETURNS trigger AS $$
DECLARE su_org text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW."serviceUserId" <> OLD."serviceUserId" THEN
    SELECT "organisationId" INTO su_org FROM "ServiceUser" WHERE id = NEW."serviceUserId";
    IF su_org IS DISTINCT FROM NEW."organisationId" THEN
      RAISE EXCEPTION 'Visit organisation must match its service user';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status <> OLD.status AND NOT (
       (OLD.status = 'SCHEDULED' AND NEW.status IN ('IN_PROGRESS', 'MISSED', 'CANCELLED', 'NOT_DELIVERED')) OR
       (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('COMPLETED')) OR
       (OLD.status = 'MISSED' AND NEW.status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')) OR
       (OLD.status = 'CANCELLED' AND NEW.status IN ('SCHEDULED')) OR
       (OLD.status = 'NOT_DELIVERED' AND NEW.status IN ('SCHEDULED'))
     ) THEN
    RAISE EXCEPTION 'Illegal visit transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER visit_guard BEFORE INSERT OR UPDATE ON "Visit"
  FOR EACH ROW EXECUTE FUNCTION csb_visit_guard();

-- Keep assignment times and blocking in step with their visit.
CREATE OR REPLACE FUNCTION csb_visit_assignment_follow() RETURNS trigger AS $$
BEGIN
  IF NEW."scheduledStart" <> OLD."scheduledStart" OR NEW."scheduledEnd" <> OLD."scheduledEnd" OR NEW.status <> OLD.status THEN
    -- The BEFORE trigger on VisitAssignment recomputes times and blocking from the visit.
    UPDATE "VisitAssignment" SET "startsAt" = NEW."scheduledStart" WHERE "visitId" = NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER visit_assignment_follow AFTER UPDATE ON "Visit"
  FOR EACH ROW EXECUTE FUNCTION csb_visit_assignment_follow();

CREATE OR REPLACE FUNCTION csb_template_guard() RETURNS trigger AS $$
DECLARE su_org text;
BEGIN
  SELECT "organisationId" INTO su_org FROM "ServiceUser" WHERE id = NEW."serviceUserId";
  IF su_org IS DISTINCT FROM NEW."organisationId" THEN
    RAISE EXCEPTION 'VisitTemplate organisation must match its service user';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER visit_template_guard BEFORE INSERT OR UPDATE ON "VisitTemplate"
  FOR EACH ROW EXECUTE FUNCTION csb_template_guard();

-- Delivery records are append-only: corrections are new rows with a reason.
CREATE TRIGGER visit_clock_immutable BEFORE UPDATE OR DELETE ON "VisitClock"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();
CREATE TRIGGER visit_event_immutable BEFORE UPDATE OR DELETE ON "VisitEvent"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();
CREATE TRIGGER visit_note_immutable BEFORE UPDATE OR DELETE ON "VisitNote"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();
CREATE TRIGGER visit_task_outcome_immutable BEFORE UPDATE OR DELETE ON "VisitTaskOutcome"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();

-- Office clock events always carry a reason.
ALTER TABLE "VisitClock" ADD CONSTRAINT visit_clock_office_reason_chk CHECK ("method" <> 'OFFICE' OR length(coalesce("reason", '')) >= 5);

-- Care plans: content is frozen once a version leaves draft; status follows the review workflow.
CREATE OR REPLACE FUNCTION csb_care_plan_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Cannot delete care plan in status %', OLD.status; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.summary IS DISTINCT FROM OLD.summary OR NEW.version <> OLD.version OR NEW."serviceUserId" <> OLD."serviceUserId") THEN
    RAISE EXCEPTION 'Care plan version % is % and its content is immutable', OLD.version, OLD.status;
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'IN_REVIEW') OR
       (OLD.status = 'IN_REVIEW' AND NEW.status IN ('DRAFT', 'ACTIVE')) OR
       (OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED')
     ) THEN
    RAISE EXCEPTION 'Illegal care plan transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER care_plan_guard BEFORE UPDATE OR DELETE ON "CarePlan"
  FOR EACH ROW EXECUTE FUNCTION csb_care_plan_guard();

CREATE OR REPLACE FUNCTION csb_care_plan_section_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "CarePlan" WHERE id = COALESCE(NEW."carePlanId", OLD."carePlanId");
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'Sections of a % care plan cannot change', st;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER care_plan_section_guard BEFORE INSERT OR UPDATE OR DELETE ON "CarePlanSection"
  FOR EACH ROW EXECUTE FUNCTION csb_care_plan_section_guard();

-- One active care plan per person.
CREATE UNIQUE INDEX care_plan_one_active ON "CarePlan" ("serviceUserId") WHERE status = 'ACTIVE';

-- Approved finance runs are frozen: lines of an approved run cannot change, and a run cannot return to draft.
CREATE OR REPLACE FUNCTION csb_finance_run_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Cannot delete a % run', OLD.status; END IF;
    RETURN OLD;
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('APPROVED', 'VOID')) OR
       (OLD.status = 'APPROVED' AND NEW.status = 'VOID')
     ) THEN
    RAISE EXCEPTION 'Illegal finance run transition % -> %', OLD.status, NEW.status;
  END IF;
  IF OLD.status <> 'DRAFT' AND NEW."totalPence" <> OLD."totalPence" THEN
    RAISE EXCEPTION 'An approved run total cannot change';
  END IF;
  IF NEW.status = 'APPROVED' AND OLD.status = 'DRAFT' AND NEW."approvedById" = NEW."createdById" THEN
    RAISE EXCEPTION 'The person who prepared a run cannot approve it';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER invoice_run_guard BEFORE UPDATE OR DELETE ON "InvoiceRun"
  FOR EACH ROW EXECUTE FUNCTION csb_finance_run_guard();
CREATE TRIGGER pay_run_guard BEFORE UPDATE OR DELETE ON "PayRun"
  FOR EACH ROW EXECUTE FUNCTION csb_finance_run_guard();

CREATE OR REPLACE FUNCTION csb_invoice_line_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT r.status INTO st FROM "Invoice" i JOIN "InvoiceRun" r ON r.id = i."runId" WHERE i.id = COALESCE(NEW."invoiceId", OLD."invoiceId");
  IF st IS NOT NULL AND st <> 'DRAFT' THEN RAISE EXCEPTION 'Lines of a % invoice run cannot change', st; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER invoice_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION csb_invoice_line_guard();

CREATE OR REPLACE FUNCTION csb_pay_line_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "PayRun" WHERE id = COALESCE(NEW."runId", OLD."runId");
  IF st IS NOT NULL AND st <> 'DRAFT' THEN RAISE EXCEPTION 'Lines of a % pay run cannot change', st; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER pay_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "PayLine"
  FOR EACH ROW EXECUTE FUNCTION csb_pay_line_guard();
