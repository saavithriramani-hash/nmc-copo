-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OutcomeKind" AS ENUM ('PO', 'PSO');

-- CreateEnum
CREATE TYPE "AssessmentShape" AS ENUM ('SECTIONED', 'ITEM_LIST', 'SINGLE_SCORE');

-- CreateEnum
CREATE TYPE "ScoringRule" AS ENUM ('RUBRIC', 'COHORT_BAND');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'LOCKED');

-- CreateEnum
CREATE TYPE "RoleKind" AS ENUM ('ADMIN', 'PRINCIPAL', 'IQAC', 'PROGRAMME_COORDINATOR', 'HOD', 'FACULTY');

-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('LOCAL', 'GOOGLE');

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "thresholdFraction" DECIMAL(4,3) NOT NULL,
    "bands" JSONB NOT NULL,
    "cohortBands" JSONB NOT NULL,
    "weightGroups" JSONB NOT NULL,
    "directWeight" DECIMAL(4,3) NOT NULL,
    "indirectWeight" DECIMAL(4,3) NOT NULL,
    "targetAttainment" DECIMAL(4,2) NOT NULL,
    "feedbackResponseFloor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Programme" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "thresholdFraction" DECIMAL(4,3),
    "bands" JSONB,
    "cohortBands" JSONB,
    "weightGroups" JSONB,
    "directWeight" DECIMAL(4,3),
    "indirectWeight" DECIMAL(4,3),
    "targetAttainment" DECIMAL(4,2),
    "feedbackResponseFloor" INTEGER,

    CONSTRAINT "Programme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgrammeOutcome" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "OutcomeKind" NOT NULL,
    "statement" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,

    CONSTRAINT "ProgrammeOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startYear" INTEGER NOT NULL,
    "endYear" INTEGER NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchRoster" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "registerNumber" TEXT NOT NULL,

    CONSTRAINT "BatchRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "semester" INTEGER NOT NULL,
    "credits" DECIMAL(4,1),
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "thresholdFraction" DECIMAL(4,3),
    "bands" JSONB,
    "cohortBands" JSONB,
    "weightGroups" JSONB,
    "directWeight" DECIMAL(4,3),
    "indirectWeight" DECIMAL(4,3),
    "targetAttainment" DECIMAL(4,2),
    "feedbackResponseFloor" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseInstructor" (
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CourseInstructor_pkey" PRIMARY KEY ("courseId","userId")
);

-- CreateTable
CREATE TABLE "CourseOutcome" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "bloomLevel" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,

    CONSTRAINT "CourseOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticulationMatrix" (
    "coId" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "strength" INTEGER NOT NULL,

    CONSTRAINT "ArticulationMatrix_pkey" PRIMARY KEY ("coId","poId")
);

-- CreateTable
CREATE TABLE "Enrolment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "rosterEntryId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,

    CONSTRAINT "Enrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shape" "AssessmentShape" NOT NULL,
    "scoringRule" "ScoringRule" NOT NULL,
    "weightGroup" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "sectionId" TEXT,
    "label" TEXT NOT NULL,
    "maxMark" DECIMAL(6,2) NOT NULL,
    "coId" TEXT,
    "displayOrder" INTEGER NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentCoTag" (
    "assessmentId" TEXT NOT NULL,
    "coId" TEXT NOT NULL,

    CONSTRAINT "AssessmentCoTag_pkey" PRIMARY KEY ("assessmentId","coId")
);

-- CreateTable
CREATE TABLE "MarkValue" (
    "enrolmentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "value" DECIMAL(6,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarkValue_pkey" PRIMARY KEY ("enrolmentId","itemId")
);

-- CreateTable
CREATE TABLE "IndirectFeedback" (
    "coId" TEXT NOT NULL,
    "n1" INTEGER NOT NULL,
    "n2" INTEGER NOT NULL,
    "n3" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndirectFeedback_pkey" PRIMARY KEY ("coId")
);

-- CreateTable
CREATE TABLE "AttainmentSnapshot" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "AttainmentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "identityProvider" "IdentityProvider" NOT NULL DEFAULT 'LOCAL',
    "passwordHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "RoleKind" NOT NULL,
    "departmentId" TEXT,
    "programmeId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Institution_name_key" ON "Institution"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_institutionId_name_key" ON "Department"("institutionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Programme_departmentId_name_key" ON "Programme"("departmentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProgrammeOutcome_programmeId_code_key" ON "ProgrammeOutcome"("programmeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_programmeId_name_key" ON "Batch"("programmeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BatchRoster_batchId_registerNumber_key" ON "BatchRoster"("batchId", "registerNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BatchRoster_batchId_studentId_key" ON "BatchRoster"("batchId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "BatchRoster_id_batchId_key" ON "BatchRoster"("id", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "Course_batchId_code_key" ON "Course"("batchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Course_id_batchId_key" ON "Course"("id", "batchId");

-- CreateIndex
CREATE INDEX "CourseInstructor_userId_idx" ON "CourseInstructor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseOutcome_courseId_code_key" ON "CourseOutcome"("courseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CourseOutcome_id_courseId_key" ON "CourseOutcome"("id", "courseId");

-- CreateIndex
CREATE INDEX "ArticulationMatrix_poId_idx" ON "ArticulationMatrix"("poId");

-- CreateIndex
CREATE INDEX "Enrolment_rosterEntryId_idx" ON "Enrolment"("rosterEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrolment_courseId_rosterEntryId_key" ON "Enrolment"("courseId", "rosterEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrolment_id_courseId_key" ON "Enrolment"("id", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_courseId_name_key" ON "Assessment"("courseId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_id_courseId_key" ON "Assessment"("id", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Section_assessmentId_name_key" ON "Section"("assessmentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Section_id_assessmentId_key" ON "Section"("id", "assessmentId");

-- CreateIndex
CREATE INDEX "Item_sectionId_idx" ON "Item"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_assessmentId_label_key" ON "Item"("assessmentId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "Item_id_assessmentId_key" ON "Item"("id", "assessmentId");

-- CreateIndex
CREATE INDEX "AssessmentCoTag_coId_idx" ON "AssessmentCoTag"("coId");

-- CreateIndex
CREATE INDEX "MarkValue_assessmentId_enrolmentId_idx" ON "MarkValue"("assessmentId", "enrolmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AttainmentSnapshot_courseId_version_key" ON "AttainmentSnapshot"("courseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Role_userId_idx" ON "Role"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_at_idx" ON "AuditLog"("entityType", "entityId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_at_idx" ON "AuditLog"("actorId", "at");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Programme" ADD CONSTRAINT "Programme_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammeOutcome" ADD CONSTRAINT "ProgrammeOutcome_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchRoster" ADD CONSTRAINT "BatchRoster_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchRoster" ADD CONSTRAINT "BatchRoster_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseInstructor" ADD CONSTRAINT "CourseInstructor_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseInstructor" ADD CONSTRAINT "CourseInstructor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseOutcome" ADD CONSTRAINT "CourseOutcome_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticulationMatrix" ADD CONSTRAINT "ArticulationMatrix_coId_fkey" FOREIGN KEY ("coId") REFERENCES "CourseOutcome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticulationMatrix" ADD CONSTRAINT "ArticulationMatrix_poId_fkey" FOREIGN KEY ("poId") REFERENCES "ProgrammeOutcome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_courseId_batchId_fkey" FOREIGN KEY ("courseId", "batchId") REFERENCES "Course"("id", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_rosterEntryId_batchId_fkey" FOREIGN KEY ("rosterEntryId", "batchId") REFERENCES "BatchRoster"("id", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_sectionId_assessmentId_fkey" FOREIGN KEY ("sectionId", "assessmentId") REFERENCES "Section"("id", "assessmentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_coId_fkey" FOREIGN KEY ("coId") REFERENCES "CourseOutcome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentCoTag" ADD CONSTRAINT "AssessmentCoTag_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentCoTag" ADD CONSTRAINT "AssessmentCoTag_coId_fkey" FOREIGN KEY ("coId") REFERENCES "CourseOutcome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkValue" ADD CONSTRAINT "MarkValue_enrolmentId_courseId_fkey" FOREIGN KEY ("enrolmentId", "courseId") REFERENCES "Enrolment"("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkValue" ADD CONSTRAINT "MarkValue_itemId_assessmentId_fkey" FOREIGN KEY ("itemId", "assessmentId") REFERENCES "Item"("id", "assessmentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkValue" ADD CONSTRAINT "MarkValue_assessmentId_courseId_fkey" FOREIGN KEY ("assessmentId", "courseId") REFERENCES "Assessment"("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndirectFeedback" ADD CONSTRAINT "IndirectFeedback_coId_fkey" FOREIGN KEY ("coId") REFERENCES "CourseOutcome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttainmentSnapshot" ADD CONSTRAINT "AttainmentSnapshot_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttainmentSnapshot" ADD CONSTRAINT "AttainmentSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- Hand-written constraints (part of the schema of record; Prisma cannot
-- express CHECK constraints or triggers in schema.prisma).
-- ─────────────────────────────────────────────────────────────────────────

-- A mark can be NULL (did not attempt) but never negative. The upper bound
-- (value ≤ item maximum) spans two tables and is enforced by validation in
-- the application and again by the engine.
ALTER TABLE "MarkValue" ADD CONSTRAINT "MarkValue_value_non_negative"
  CHECK ("value" IS NULL OR "value" >= 0);

-- Articulation strengths are exactly 1, 2 or 3 (Procedure Step 1);
-- "unmapped" is the absence of the row, never a 0 or a NULL.
ALTER TABLE "ArticulationMatrix" ADD CONSTRAINT "ArticulationMatrix_strength_range"
  CHECK ("strength" IN (1, 2, 3));

-- An item worth nothing cannot be marked.
ALTER TABLE "Item" ADD CONSTRAINT "Item_maxMark_positive"
  CHECK ("maxMark" > 0);

-- Feedback counts are counts.
ALTER TABLE "IndirectFeedback" ADD CONSTRAINT "IndirectFeedback_counts_non_negative"
  CHECK ("n1" >= 0 AND "n2" >= 0 AND "n3" >= 0);

-- Snapshot versions start at 1.
ALTER TABLE "AttainmentSnapshot" ADD CONSTRAINT "AttainmentSnapshot_version_positive"
  CHECK ("version" >= 1);

-- A role's effect window must be well-formed (§2: assignments carry
-- effect dates).
ALTER TABLE "Role" ADD CONSTRAINT "Role_effective_window"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

-- ─────────────────────────────────────────────────────────────────────────
-- AttainmentSnapshot is immutable once written (requirements §3, FR-16):
-- unlocking a locked course creates a NEW version; history is never
-- rewritten. Enforced by the database itself, not merely by application
-- code: any UPDATE or DELETE is rejected outright.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prevent_attainment_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AttainmentSnapshot rows are immutable: unlocking a course creates a new version (FR-16); % is not permitted', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

CREATE TRIGGER "AttainmentSnapshot_immutable"
  BEFORE UPDATE OR DELETE ON "AttainmentSnapshot"
  FOR EACH ROW EXECUTE FUNCTION prevent_attainment_snapshot_mutation();
