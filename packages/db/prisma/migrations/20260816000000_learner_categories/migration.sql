-- CR-8: slow and advanced learners (NAAC 2.2.1).
--
-- Purely additive: two new tables and two nullable columns. No existing
-- row is read, rewritten or dropped, and nothing here touches marks,
-- attainment or the ten steps.

-- The band table that turns a score into a category. Nullable at both
-- levels; null means the engine's DEFAULT_CATEGORY_BANDS, so a college
-- that never opens this report configures nothing.
ALTER TABLE "Institution" ADD COLUMN "learnerBands" JSONB;
ALTER TABLE "Programme"   ADD COLUMN "learnerBands" JSONB;

-- What students are rated on, per programme.
CREATE TABLE "LearnerCriterion" (
    "id"           TEXT NOT NULL,
    "programmeId"  TEXT NOT NULL,
    "label"        TEXT NOT NULL,
    "maxScore"     DECIMAL(6,2) NOT NULL,
    "derived"      BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL,

    CONSTRAINT "LearnerCriterion_pkey" PRIMARY KEY ("id")
);

-- A criterion out of nothing would make every score a division by zero.
ALTER TABLE "LearnerCriterion" ADD CONSTRAINT "LearnerCriterion_maxScore_positive"
  CHECK ("maxScore" > 0);

CREATE UNIQUE INDEX "LearnerCriterion_programmeId_label_key"
  ON "LearnerCriterion" ("programmeId", "label");
CREATE INDEX "LearnerCriterion_programmeId_idx"
  ON "LearnerCriterion" ("programmeId");

ALTER TABLE "LearnerCriterion" ADD CONSTRAINT "LearnerCriterion_programmeId_fkey"
  FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One teacher's judgement of one student on one criterion, in one course.
--
-- `score` NULL is "not yet rated" and is emphatically not zero: the
-- engine drops an unrated criterion from the numerator AND the divisor,
-- so a half-filled sheet cannot push a student towards "slow learner".
CREATE TABLE "LearnerRating" (
    "enrolmentId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "score"       DECIMAL(6,2),
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerRating_pkey" PRIMARY KEY ("enrolmentId", "criterionId")
);

-- A negative rating has no meaning; the upper bound is the criterion's
-- own maximum and is checked in the engine, which can see both rows.
ALTER TABLE "LearnerRating" ADD CONSTRAINT "LearnerRating_score_nonnegative"
  CHECK ("score" IS NULL OR "score" >= 0);

CREATE INDEX "LearnerRating_criterionId_idx" ON "LearnerRating" ("criterionId");

ALTER TABLE "LearnerRating" ADD CONSTRAINT "LearnerRating_enrolmentId_fkey"
  FOREIGN KEY ("enrolmentId") REFERENCES "Enrolment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearnerRating" ADD CONSTRAINT "LearnerRating_criterionId_fkey"
  FOREIGN KEY ("criterionId") REFERENCES "LearnerCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
