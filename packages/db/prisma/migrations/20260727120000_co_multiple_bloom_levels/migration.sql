-- A CO carries one or more Bloom's taxonomy levels rather than exactly
-- one: a single outcome commonly spans two adjacent levels ("explain and
-- apply"), and forcing a choice loses that.
--
-- Display-only metadata; no attainment number depends on it, so this
-- migration cannot change any computed figure. Existing rows keep their
-- level as a one-element list, so nothing is lost.

-- AlterTable
ALTER TABLE "CourseOutcome" ADD COLUMN "bloomLevels" TEXT[] NOT NULL DEFAULT '{}';

-- Carry every existing single level across before the old column goes.
UPDATE "CourseOutcome" SET "bloomLevels" = ARRAY["bloomLevel"];

-- The default existed only to add a NOT NULL column to populated tables.
ALTER TABLE "CourseOutcome" ALTER COLUMN "bloomLevels" DROP DEFAULT;

ALTER TABLE "CourseOutcome" DROP COLUMN "bloomLevel";

-- FR-5 still requires a CO to declare its level; "one or more" is not
-- "none". Prisma cannot express this, so it lives here.
ALTER TABLE "CourseOutcome" ADD CONSTRAINT "CourseOutcome_bloomLevels_non_empty"
  CHECK (cardinality("bloomLevels") >= 1);
