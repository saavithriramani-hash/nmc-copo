-- ─────────────────────────────────────────────────────────────────────────
-- Review rounds (FR-16): a course submitted for approval, and what the
-- Head of Department did with it.
--
-- Until now the workflow had three moves — submit, lock, unlock — and no
-- way for a HoD to send a submission back. Their only options were to
-- approve it or to say nothing, so "please fix the CO tags" happened
-- outside the system and left no trace.
--
-- A row per round rather than a comment thread, because the sequence is
-- itself the evidence: submitted three times, returned twice, and here
-- is why each time. `returnComment` is written once and never edited —
-- it is part of how a locked course came to be approved.
--
-- ADDITIVE. No existing row changes, and courses already locked simply
-- have no rounds recorded, which is the truth about them.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE "SubmissionResolution" AS ENUM ('PENDING', 'RETURNED', 'APPROVED');

CREATE TABLE "CourseSubmission" (
  "id"              TEXT NOT NULL,
  "courseId"        TEXT NOT NULL,
  "submittedById"   TEXT NOT NULL,
  "submittedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolution"      "SubmissionResolution" NOT NULL DEFAULT 'PENDING',
  "resolvedById"    TEXT,
  "resolvedAt"      TIMESTAMP(3),
  "returnComment"   TEXT,
  "approvedVersion" INTEGER,
  CONSTRAINT "CourseSubmission_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CourseSubmission"
  ADD CONSTRAINT "CourseSubmission_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourseSubmission"
  ADD CONSTRAINT "CourseSubmission_submittedById_fkey"
  FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourseSubmission"
  ADD CONSTRAINT "CourseSubmission_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The dashboards' hot queries.
CREATE INDEX "CourseSubmission_courseId_submittedAt_idx"
  ON "CourseSubmission" ("courseId", "submittedAt");
-- "What is waiting for me?" across a department, answered without
-- touching a mark.
CREATE INDEX "CourseSubmission_resolution_submittedAt_idx"
  ON "CourseSubmission" ("resolution", "submittedAt");

-- ─────────────────────────────────────────────────────────────────────────
-- Hand-written constraints (part of the schema of record).
-- ─────────────────────────────────────────────────────────────────────────

-- A returned round MUST say why, and only a returned round carries a
-- reason. The whole point of the feature is that a rejection is never
-- silent, so a returned row with no comment is made unrepresentable
-- rather than merely discouraged in the action layer.
ALTER TABLE "CourseSubmission" ADD CONSTRAINT "CourseSubmission_return_has_reason" CHECK (
  ("resolution" = 'RETURNED' AND "returnComment" IS NOT NULL AND length(btrim("returnComment")) > 0) OR
  ("resolution" <> 'RETURNED' AND "returnComment" IS NULL)
);

-- A resolved round records who resolved it and when; a pending one has
-- neither. Without this a round could be marked approved by nobody.
ALTER TABLE "CourseSubmission" ADD CONSTRAINT "CourseSubmission_resolution_is_attributed" CHECK (
  ("resolution" = 'PENDING' AND "resolvedById" IS NULL AND "resolvedAt" IS NULL) OR
  ("resolution" <> 'PENDING' AND "resolvedById" IS NOT NULL AND "resolvedAt" IS NOT NULL)
);

-- At most ONE round awaiting the HoD per course. Submitting twice would
-- otherwise leave two open rounds and make "how long has this been
-- waiting?" unanswerable.
CREATE UNIQUE INDEX "CourseSubmission_one_pending_per_course"
  ON "CourseSubmission" ("courseId")
  WHERE "resolution" = 'PENDING';
