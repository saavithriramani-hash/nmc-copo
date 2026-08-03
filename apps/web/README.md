# @copo/web

Next.js (App Router) UI. This stage covers the **setup surface**:
departments, programmes, PO/PSO definitions, batches, courses, COs, the
articulation matrix, assessments, department assessment templates, and
course-setup cloning.

## Ground rules

- **Every mutation is a server action that calls `guard.require` first**
  (`lib/authz.ts` builds the one Guard). Page components render what the
  server authorised; they never carry permission checks. Reading any
  course page passes `course.read` in the course layout; a guessed id
  and a forbidden id both look like "not found".
- **Sessions**: httpOnly cookie, validated server-side per request
  (`lib/session.ts`); forced first-login password change is a redirect
  everything passes through. Login/logout/change wire `@copo/auth`.
- **Setup mutations are audit-logged** (who, what, prior value — FR-17).
- **Dense and keyboard-friendly** for Excel-comfortable faculty: table
  editors where Enter adds the next row; the matrix takes 1/2/3 from the
  keyboard and moves like a spreadsheet; explicit Save buttons with an
  unsaved-changes flag; no drag-and-drop, no hidden gestures.

## The screens

| Screen | Notes |
|---|---|
| `/` | Courses scoped like the Guard scopes them (own courses / whole department) |
| `/admin/departments` | Admin: institution bootstrap (engine defaults), departments, programmes. **Rename and delete** for department/programme (admin alone) and for batch (batch controls live on the programme page, and are the HoD's too under CR-2): deletion refuses while anything references the row and names every blocker; never a cascade over courses, marks, rosters, roles or locked snapshots. `onDelete: Restrict` enforces the same rule at the database, so the check-then-delete race fails safe |
| `/admin/users` | Admin: accounts and role assignments (§2). Create account → one-time temporary password (returned in the action result, never in a URL); grant/end roles with effect dates; reset, deactivate, reactivate. Refuses to strand the institution: you cannot deactivate yourself, nor end the last administrator |
| `/programmes/[id]` | The **HoD of the programme's department** edits PO/PSOs (`programme.manage`) — there is no programme coordinator, and one HoD covers every programme of the department. **Batches — add, rename, delete — belong to that HoD as well as to the admin** (`batches.manage`, CR-2): the HoD owns the roster that goes into a batch, so waiting on the administrator for the container, and again for a mistyped year, helped nobody. It is a department-scoped action of its own, not a widening of `departments.manage` — managing a batch must not carry the power to create or destroy departments and programmes, whose own controls stay admin-only. Deleting a batch still refuses while any course or roster entry references it |
| `/courses/new` | HoD creates a course (`course.create`, server-derived department) |
| `/courses/[id]` | Details (faculty, while DRAFT) + assigned faculty. **Staffing is `course.staff` — HoD only**: faculty see the roster read-only. Assigning an account without the Faculty role is refused (it would grant nothing), and the last instructor cannot be removed |
| `…/outcomes` | CO editor (code, statement, Bloom levels, reorder). A CO carries **one or more** Bloom levels (checkboxes), stored deduplicated in taxonomy order; at least one is required (CHECK-enforced). Display-only — no attainment figure depends on them. Note FR-5 says "Bloom's level" singular: this is a deliberate change against that baseline |
| `…/matrix` | COs down, POs/PSOs across, cells 1/2/3/blank. **Weightages recompute live under each column via the engine's own `step1ArticulationWeightages`** — what faculty see while typing is what the report computes |
| `…/assessments` | List + add (any shape/rule/group) + **adopt template** + **clone setup** + save-as-template (HoD). A **Maximum marks** column shows each assessment's total, derived from its items (plural, as every question paper prints it; the structure editor's per-item **Max mark** stays singular because it is what one question is worth) (there is no `maxMark` column on `Assessment`), honouring §3.1 "answer any n of m" — where a section caps how many questions count, the obtainable maximum is shown against the printed total. A trailing **delete** column appears only for someone who may edit the course. Its button is live only while an assessment has no marks; once marks exist the same button is greyed out, with the count and the reason in its tooltip — deleting would destroy student data and change every figure derived from it |
| `…/assessments/[id]` | Structure editor: unlimited user-named sections (with an "answer any n of m" rule), item tables with per-item CO tags, single-score CO tag checkboxes |
| `/batches/[id]/roster` | Roster import from Excel/CSV with a full preview; roster list (HoD/admin). **Download a blank template** (`/api/batches/[id]/roster/template`, `roster.manage` — the same authority as the import it feeds): CSV with a BOM so Excel reads UTF-8, headers the importer actually matches, two example rows showing the with-email and without-email shapes, and `#` guidance lines the parser skips. **Blank, unlike the mark template, which is deliberately pre-filled** — roster import only ever creates, so there is nothing for an empty file to destroy, and a pre-filled one would put 4,000 names on somebody's laptop |
| `…/enrolment` | Draw a course's students from the batch roster — tick names, never type register numbers |
| `…/marks` → `…/marks/[id]` | Assessment picker → the mark entry grid + paste/upload. The picker also carries **all assessments in one file**: download a course-wide workbook (a sheet per assessment) and upload it back, previewed and applied all-or-nothing |
| `…/feedback` | **CO-wise indirect feedback (Step 8)** — the 3-point tally per outcome, entered as aggregate counts. `course.write`, like COs and assessments. The indirect value previews live via the engine's own `step8IndirectAttainment`. A blank row is stored as **no row**, so the engine yields `null` and the course reports direct-only; it is never a rating of zero |
| `…/review` | Pre-calculation anomaly report (FR-13), the six checks |
| `…/attainment` | Computed attainment, prominent warnings, workflow controls, and the full drill-down |
| `…/versions` | Immutable snapshot history with what changed between versions |
| `…/settings` | Course parameter overrides (§4). **Rubric threshold**: editable only by the HoD of the course's department (`settings.course.write`), never on a LOCKED course; everyone who can read the course sees it read-only. Shows the value in force and its Step-2 provenance, a live worked example, and a Remove-override control. Entered as a percentage, stored as the engine's fraction; audit-logged with the prior value |
| `/programmes/[id]/consolidation` | Programme consolidation as a background job |
| `/institution` | Institution consolidation (Dean/IQAC/Principal) |
| `/institution/parameters` | **Attainment bands and weights (§4.2–§4.4)** — the §4.2 band table, the §4.3 end-semester cohort bands, the Step 9 weight groups and the direct/indirect blend. Edited by the **Dean alone** (`settings.institution.write`); the IQAC and the Principal read them, the administrator cannot reach them. Institution-level only: no programme or course override is offered for these, unlike the rubric threshold. Drafts are validated by the engine's own `validateParameters`, so nothing storable is uncomputable; the full prior set is audit-logged |
| `/audit` | Audit log (admin/Dean/IQAC): who changed what, when, prior value |
| `/templates` | HoD: department templates with structure summaries |

## Engine wiring, drill-down and approval

- **Course computation is on demand** (`lib/compute.ts`): one course's
  marks through the adapter into the pure engine. Nothing derived is
  stored, so every figure always reflects the current marks — except a
  **LOCKED** course, which renders its immutable snapshot, because that is
  the record of what was approved.
- **The drill-down** (`components/DrillDown.tsx`) is a *server* component
  built on native `<details>`: no JavaScript, keyboard-operable, and the
  whole chain is on the page. From a PO figure: Step 10 arithmetic → the
  Step 1 weightage and its CO strengths → each CO's Step 9 blend → the
  weight groups (Step 5) → the assessments (Step 4, sections included) →
  each item (Step 3: threshold, attempted, cleared, band) → **the raw
  marks, student by student**, flagged cleared / attempted-not-cleared /
  blank-excluded. "Cleared" is decided by the engine's own `ratioGte`, so
  the list can never disagree with the count it explains.
- **Warnings are prominent**: a computed-with-warnings course shows a
  bordered panel listing every code and message, and **cannot be locked**
  until they are acknowledged. The acknowledgement carries a
  `warningsFingerprint`; if marks change between review and lock, the
  server refuses and demands a re-read.
- **Workflow (FR-16)**: submit → lock → immutable versioned snapshot
  holding the engine input, the full result, the display maps, the
  parameters in force and the engine version. Unlocking returns the course
  to DRAFT and writes nothing over the snapshot (a DB trigger forbids it);
  re-locking writes version n+1. Every transition is audit-logged with its
  prior value, and unlocking requires a recorded reason.
- **Consolidations are background jobs** (`lib/jobs.ts`, `Job` table): the
  action creates a row and returns a job id immediately; a detached runner
  updates `progress`/`progressNote` per course while the page polls. One
  broken course records its error and the run continues. DB-backed and
  in-process — no queue service for the IT staff to run (NFR-5).

## Roster, enrolment and marks (FR-10 / FR-11 / FR-12 / FR-13)

- **Roster import** (`lib/roster.ts` pure parse/diff; `lib/spreadsheet.ts`
  exceljs/CSV decode) is two-step: upload → preview exactly what will be
  created (new vs already-present, per-row errors) → confirm. Register
  numbers are entered here, once per batch, and never typed into a course.
- **Enrolment** draws from the roster into `Enrolment` rows; a student
  with marks cannot be unenrolled (UI-disabled and FK-enforced).
- **Mark entry grid** (`components/MarkGrid.tsx`) — the screen faculty
  live in:
  - students down, items across (sections grouped in the header), sticky
    row/column headers;
  - full keyboard nav — arrows (Left/Right cross cells at the input
    edges), Enter/Down next row, Tab across;
  - **blank ≠ zero, visibly**: an empty cell is hatched (did not attempt);
    a real `0` shows plainly. A legend states both;
  - per-cell validation against the maximum, red-ringed immediately;
    invalid cells are never saved;
  - **incremental autosave** (debounced) of only the changed cells via the
    indexed bulk-upsert (`@copo/db` `bulkUpsertMarks`); every keystroke also
    writes a `localStorage` draft, so a dropped connection or reload is
    **restored and re-saved**, losing nothing;
  - an unambiguous status line: Saved ✓ / Saving… / N unsaved (retrying) /
    N invalid.
- **Paste or upload** one assessment's marks (`lib/marks.ts` pure planner),
  matched on register number, with **every** change previewed (old → new)
  before a row is written; empty cells import as blank.
- **Download one workbook for the whole course**
  (`/api/courses/[id]/marks/template`, `marks.write`) — a sheet per
  assessment, students down, questions across, **carrying every mark
  already recorded**, plus an Instructions sheet first. Fill in any or
  all of the sheets and upload it back on the Marks tab. Sheets are
  matched to assessments by name, re-derived at upload from the current
  assessments: a sheet matching nothing is **reported, never guessed**,
  because writing one assessment's marks onto another is the failure to
  avoid — so an assessment renamed after downloading shows up as an
  ignored sheet. Excel caps a sheet name at 31 characters and forbids
  `: \ / ? * [ ]`, so names are sanitised and de-duplicated ("Continuous
  Internal Assessment I" and "…II" both clip to the same 31). The
  preview groups changes by assessment; **the import is applied in one
  transaction, all of it or none**, since "three of eight assessments
  applied" is not a state anyone can reason about before a lock.
- **Download the mark sheet** for an assessment
  (`/api/courses/[id]/assessments/[id]/template`, `marks.write`): every
  enrolled student down, every question across, **carrying the marks
  already recorded**. That pre-fill is not convenience — an empty sheet
  uploaded over a part-marked assessment would read as "nobody attempted
  anything" and blank every stored mark. An untouched download therefore
  proposes zero changes. Column headings are exactly the item labels
  because the importer matches on them, so the maxima and the blank ≠ zero
  guidance live on a second sheet the importer never reads; Excel
  validation caps each column at its item maximum while still allowing an
  empty cell.
- **Anomaly report** (`lib/anomalies.ts`, aggregated in SQL — NFR-1) runs
  the six FR-13 checks before compute: marks over maximum, over-attempted
  optional sections, students with no marks, unattempted items, COs
  assessed nowhere, feedback below the floor.

## Templates and cloning (FR-8 / FR-9)

A template is **captured from a real course** (HoD: "Save as department
template") — CO tags are stored as CO-position slots — and **adopted in
one action** on any empty course of the department, then adjusted. Slots
beyond the course's CO count come through untagged with an explicit
warning. Cloning copies COs + matrix + assessments from any course the
user can read into an empty course (matrix only within the same
programme; never marks, enrolments, or parameter overrides). The pure
plan logic lives in `lib/setupPlans.ts`, unit-tested without a database.

## Run

```bash
# database up + migrated + seeded (see packages/db/README.md), then:
npm run dev -w @copo/web
# seeded dev logins (password "copo-dev-password"):
#   admin@nmc.dev, hod.math@nmc.dev, faculty1@nmc.dev, faculty2@nmc.dev, dean@nmc.dev, iqac@nmc.dev
```

Verified without a database: 41 web pure-logic tests (setup plans, the
delimited/roster/mark-import parsers, the anomaly classifiers, the
consolidation mean and the snapshot diff/fingerprint), full typecheck,
and a clean `next build` (all 24 routes compile). Not yet verified: live
browser flows against a running Postgres — this machine has no Docker;
exercise the seed + login + roster-import + mark-entry + compute + lock
flows on a machine that does. Mark entry's autosave, the SQL-aggregated
anomaly queries, and the background job runner are the parts that most
need a live run.
