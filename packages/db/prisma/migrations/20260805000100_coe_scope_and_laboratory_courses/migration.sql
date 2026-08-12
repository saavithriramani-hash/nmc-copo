-- ─────────────────────────────────────────────────────────────────────────
-- CR-3, part 2 of 2: the Controller of Examinations (5 August 2026).
--
-- 1. COE is institution-wide, so the scope constraint must admit it with
--    no department. Without this every COE grant is rejected by the
--    database — the CHECK matches neither branch.
-- 2. Courses can be flagged as a practical paper. A laboratory course
--    carries its own course code, and its external examination is
--    conducted by the department, so the HoD and the course faculty own
--    that assessment and its marks rather than the COE.
-- 3. Assessment templates may be institution-wide (departmentId NULL), so
--    the COE can publish one external examination pattern for every
--    department to adopt.
--
-- ADDITIVE. No row is deleted and nothing that exists changes meaning:
-- every current course becomes a theory course, every current template
-- stays departmental.
--
-- The Laboratory flag changes NO arithmetic. It decides who may write the
-- external assessment and its marks; the ten steps, the weight groups and
-- every attainment figure are identical either way.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. role scope ────────────────────────────────────────────────────────
-- Rebuilt rather than amended: a CHECK constraint cannot be altered in
-- place. The rule is unchanged in substance — the HoD is the only scoped
-- role — and COE joins the institution-wide list.
ALTER TABLE "Role" DROP CONSTRAINT IF EXISTS "Role_scope_matches_kind";
ALTER TABLE "Role" ADD CONSTRAINT "Role_scope_matches_kind" CHECK (
  ("kind" = 'HOD' AND "departmentId" IS NOT NULL) OR
  ("kind" IN ('ADMIN', 'PRINCIPAL', 'DEAN', 'IQAC', 'COE', 'FACULTY') AND "departmentId" IS NULL)
);

-- ── 2. practical papers ──────────────────────────────────────────────────
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "isLaboratory" BOOLEAN NOT NULL DEFAULT false;

-- ── 3. institution-wide assessment templates ─────────────────────────────
ALTER TABLE "AssessmentTemplate" ALTER COLUMN "departmentId" DROP NOT NULL;

-- Postgres treats NULLs as distinct in a unique index, so the existing
-- (departmentId, name) key would happily admit ten institution-wide
-- templates all called "End-Semester Examination". This partial index
-- covers the case that one cannot.
CREATE UNIQUE INDEX IF NOT EXISTS "AssessmentTemplate_institution_name_key"
  ON "AssessmentTemplate" ("name")
  WHERE "departmentId" IS NULL;
