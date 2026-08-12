-- ─────────────────────────────────────────────────────────────────────────
-- CR-3, part 1 of 2: add the Controller of Examinations to the role enum.
--
-- ALONE IN ITS OWN MIGRATION ON PURPOSE. Prisma runs each migration in a
-- transaction, and PostgreSQL forbids USING a newly added enum label in
-- the same transaction that added it. The scope constraint in part 2
-- names 'COE', so it has to be a separate migration or every deployment
-- fails with "unsafe use of new value of enum type".
--
-- Additive: adding a value rewrites no rows and needs no cast, unlike the
-- CR-1 migration that removed one.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TYPE "RoleKind" ADD VALUE IF NOT EXISTS 'COE' AFTER 'IQAC';
