-- ─────────────────────────────────────────────────────────────────────────
-- §2 role table revision (change request against the confirmed baseline).
--
-- 1. PROGRAMME_COORDINATOR is removed. The HoD is responsible for every
--    programme of their department, so no role is programme-scoped any
--    more and Role.programmeId goes with it.
-- 2. IQAC becomes read-only: it keeps read-all, consolidation, bundles and
--    the audit log, and loses settings.institution.write.
-- 3. DEAN is added and takes what IQAC held — including the institution
--    attainment parameters (§4.2–§4.4).
--
-- DESTRUCTIVE, and deliberately so (confirmed 30 Jul 2026): PostgreSQL
-- cannot drop an enum value that rows still use, so the coordinator
-- assignments are deleted rather than closed. That role history does not
-- survive this migration.
-- ─────────────────────────────────────────────────────────────────────────

-- Coordinator assignments first: the enum cast below fails while any row
-- still holds the value being removed. The USER accounts are untouched —
-- they are referenced by audit events and sessions, and an account left
-- with no role simply cannot sign in (NO_EFFECTIVE_ROLE).
DELETE FROM "Role" WHERE "kind" = 'PROGRAMME_COORDINATOR';

-- The old constraint names PROGRAMME_COORDINATOR and reads programmeId;
-- both are about to stop existing.
ALTER TABLE "Role" DROP CONSTRAINT IF EXISTS "Role_scope_matches_kind";

ALTER TABLE "Role" DROP CONSTRAINT IF EXISTS "Role_programmeId_fkey";
ALTER TABLE "Role" DROP COLUMN IF EXISTS "programmeId";

-- Rebuild the enum: PROGRAMME_COORDINATOR out, DEAN in. RoleKind is used
-- by exactly one column, so the swap is this one cast.
CREATE TYPE "RoleKind_new" AS ENUM ('ADMIN', 'PRINCIPAL', 'DEAN', 'IQAC', 'HOD', 'FACULTY');
ALTER TABLE "Role" ALTER COLUMN "kind" TYPE "RoleKind_new" USING ("kind"::text::"RoleKind_new");
DROP TYPE "RoleKind";
ALTER TYPE "RoleKind_new" RENAME TO "RoleKind";

-- ─────────────────────────────────────────────────────────────────────────
-- Hand-written constraint (part of the schema of record).
-- Role scope must match the role kind (§2): an HoD is scoped to exactly a
-- department; every other role is institution-wide and carries no scope.
-- A mis-scoped role assignment is unrepresentable.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "Role" ADD CONSTRAINT "Role_scope_matches_kind" CHECK (
  ("kind" = 'HOD' AND "departmentId" IS NOT NULL) OR
  ("kind" IN ('ADMIN', 'PRINCIPAL', 'DEAN', 'IQAC', 'FACULTY') AND "departmentId" IS NULL)
);
