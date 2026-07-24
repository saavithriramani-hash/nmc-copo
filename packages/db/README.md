# @copo/db

Persistence layer: the Prisma schema and migrations, the local-development
seed, and the adapter that reads a course from PostgreSQL and produces the
engine's `CourseInput`. Depends on `@copo/engine`; **the engine never
depends on this package** and stays unaware a database exists.

## Local development

```bash
npm run db:up          # throwaway Postgres 16 in Docker (port 5433)
cp .env.example .env
npx prisma migrate dev # apply migrations
npx prisma db seed     # 1 dept, 1 programme, 40 students, 1 full course
npm run smoke          # adapter → engine → printed attainment chain
npm test               # adapter unit tests (pure, no database needed)
```

Re-seeding: the seed refuses a non-empty database — use
`npx prisma migrate reset` (drops, migrates, reseeds). Seed data is
deterministic (seeded PRNG) and **for development only: it validates
nothing**. Engine correctness rests solely on the hand-computed fixtures
in `packages/engine` (NFR-7).

## What the database itself enforces

Every structural rule from requirements §3 is a database constraint, not
an application convention:

| Rule | Enforcement |
|---|---|
| One roster per batch; register number entered once per batch | `BatchRoster @@unique([batchId, registerNumber])`; the number exists nowhere else |
| An enrolment never crosses batches; no free-typed register numbers in a course | `Enrolment.batchId` pinned by two composite FKs: `(courseId, batchId) → Course` and `(rosterEntryId, batchId) → BatchRoster` |
| A mark references an enrolment and an item, never a string | `MarkValue` composite FKs; no register-number column exists on it |
| A mark's enrolment and item belong to the same course/assessment | `(itemId, assessmentId) → Item`, `(assessmentId, courseId) → Assessment`, `(enrolmentId, courseId) → Enrolment` |
| Blank ≠ zero | `MarkValue.value` nullable — `NULL` is "did not attempt"; `0` is a real mark. `CHECK (value IS NULL OR value >= 0)` |
| Parameter cascade with recoverable source | Institution carries the full non-null parameter set; programme/course carry the same columns nullable (`NULL` = inherit). The adapter resolves via the engine's `step2ResolveParameters`, whose provenance says which level supplied each field |
| Snapshot immutability | `AttainmentSnapshot_immutable` trigger rejects `UPDATE`/`DELETE`; unlocking creates a new `(courseId, version)` row (FR-16) |
| Matrix strengths 1–3, item maxima > 0, feedback counts ≥ 0 | `CHECK` constraints in the initial migration |

`CHECK` constraints and the trigger live in
`prisma/migrations/20260724000000_init/migration.sql` — Prisma cannot
express them in `schema.prisma`, but the migration is the schema of
record. Do not regenerate that file; extend with new migrations.

## MarkValue at scale (NFR-1)

~25 million rows over an accreditation cycle. Exactly two access paths,
both indexed, and nothing else:

- **all marks for one enrolment** — primary key `(enrolmentId, itemId)`, prefix scan;
- **all marks for one assessment** — index `(assessmentId, enrolmentId)`.

No query anywhere loads a whole course's marks into application memory to
produce a **summary** — summaries are SQL aggregations (see
`src/queries.ts::assessmentMarkSummary`, the pattern for every future
dashboard/anomaly figure). The single exception-by-design is the
attainment computation itself: `loadCourseInput` materialises **one
course's own marks** (a few thousand values, fetched through the
assessment index) because the ten steps are computed by the engine, on
demand, from raw marks — derived values are never stored outside a locked
snapshot.

## The adapter

- `buildCourseInput(courseRows, markRows)` — **pure**; unit-tested without
  a database (`tests/adapter.test.ts`).
- `loadCourseInput(prisma, courseId)` — two queries (course aggregate +
  mark rows), then the pure transform. Returns `{ input,
  parameterResolution, refs }`: engine input keyed by opaque ids, Step-2
  provenance for the report, and id→code maps for display.
- SINGLE_SCORE assessments store one real `Item` row (marks must reference
  an item by FK); the adapter re-keys that mark under the assessment id,
  which is the engine's convention. Multi-CO tags live in
  `AssessmentCoTag`; item-level tags in `Item.coId`; `NULL`/no rows =
  untagged = applies to every CO (§3.1).
- Structurally corrupt rows (a SINGLE_SCORE with two items) throw
  `AdapterError` — the adapter never guesses.

## Verified here / verify against a live database

Verified on this machine (no Docker available): `prisma validate`,
client generation, offline-generated migration SQL, `tsc --noEmit`, and
14 pure adapter tests. Still to verify on a machine with Docker/Postgres —
in order: `npm run db:up`, `prisma migrate dev` (applies the init
migration incl. trigger), `prisma db seed`, `npm run smoke`, and a manual
`UPDATE "AttainmentSnapshot" …` to watch the trigger reject it.
