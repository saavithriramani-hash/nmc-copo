# @copo/engine

The CO–PO attainment calculation engine for Nehru Memorial College
(Autonomous). **Pure TypeScript, zero runtime dependencies** — no database,
no framework, no I/O, no clock. Marks and parameters in, the full
attainment chain out. This package is deliberately liftable: copy the
directory anywhere, run `npm install && npm test`, and every number it can
produce is re-verifiable by an auditor with no other part of the system
present.

Governing documents (source of truth, in the repository root's `docs/`):

- `COPO_App_Requirements_v1.0.md` — confirmed requirements ("§n" below)
- `CO-PO_Attainment_StepByStep_Procedure.docx` — the college's ten steps

## Procedure mapping

| Step | Function | File |
|---|---|---|
| 1 Articulation weightages | `step1ArticulationWeightages` | `src/steps/step1Weightage.ts` |
| 2 Parameter resolution | `step2ResolveParameters` | `src/steps/step2Parameters.ts` |
| 3 Score every item | `step3ScoreItems` | `src/steps/step3ItemScores.ts` |
| 4 Items → CO per assessment | `step4AssessmentCoLevels` | `src/steps/step4AssessmentCo.ts` |
| 5–7 Consolidate weight groups | `step5GroupCoLevels` | `src/steps/step5GroupCo.ts` |
| 8 Indirect attainment | `step8IndirectAttainment` | `src/steps/step8Indirect.ts` |
| 9 Final CO attainment | `step9FinalCoAttainment` | `src/steps/step9FinalCo.ts` |
| 10 PO/PSO projection | `step10PoAttainment` | `src/steps/step10Po.ts` |

Steps 6 and 7 are Step 5 applied to the continuous and external groups
(§5). `computeCourse` runs the whole chain and aggregates warnings. Every
result object carries the inputs and intermediate figures that produced
it, so a UI can drill from any PO figure down to a single item (FR-14/15).

## Learning outcome by knowledge level (CR-7) — not one of the steps

`computeKnowledgeLevels` reads a question paper by the knowledge level
each question examines: the paper's **blueprint** (the share of its marks
per level, which needs no marks at all) and what each student earned
against those allotments, banded 0–3, plus the class.

It is **standalone**. `computeCourse` does not call it, no CO or PO figure
reads it, and removing it would leave the ten steps byte-identical. It
shares the warning type and the band table, nothing else.

One invariant is deliberately inverted here, and only here: **the
denominator is the marks the paper allotted, not the marks attempted**,
because an outcome the student did not demonstrate is not an outcome they
attained — that is the college's method, and the figure would mean
something else otherwise. Blank is still not zero: unattempted marks are
counted and reported separately, a student who attempted nothing is
*absent* rather than scoring nothing, and the class figures exclude them.

## Slow and advanced learners (CR-8) — also not one of the steps

`computeLearnerCategories` identifies slow and advanced learners for NAAC
2.2.1: each subject rates a student on the programme's criteria, each
criterion is averaged across the semester's subjects, the averages are
summed, and a band table gives the category.

Standalone on the same terms as `computeKnowledgeLevels` — `computeCourse`
does not call it, no CO or PO figure reads it, and removing it would leave
the ten steps byte-identical.

Two rules here are worth knowing before reading the code:

- **The divisor is the ratings that exist**, never the subjects taken. An
  unrated criterion leaves the numerator *and* the divisor, and the
  obtainable total shrinks with it, so a student rated on four of five
  criteria is scored out of 80 rather than being punished for the fifth.
- **A student no teacher has judged is not classified**, however good
  their marks. The mark-derived criterion always has a value once marks
  exist, so without this every unjudged student in the college would be
  labelled from their mark percentage alone.

## Invariants enforced here

- **Blank ≠ zero.** A blank mark is `null` — "did not attempt", excluded
  from the denominator. `0` is a real mark, included. `undefined`/`NaN`
  are validation errors, never stand-ins for blank.
- **Levels are the integers 0–3**, typed as literals, never strings.
- **Percentages are asserted into [0, 100]**; a violation throws
  `EngineAssertionError` (an inverted ratio must never become a report).
- **Nothing missing is ever coerced to zero.** Absences propagate as
  `null` plus a structured warning (`EngineWarning`: code, message, entity
  ref). Degenerate cases (§5.1) all have defined results and tests.
- **No derived value is stored.** The engine returns plain data; persistence
  of anything except marks/parameters/locked snapshots is out of scope.

## Boundary arithmetic

Thresholds and bands are inclusive, and marks exactly on a boundary must
count. Binary floats make the naive `mark >= 0.7 * max` unreliable at
exactly those points, so every boundary decision goes through
`src/compare.ts`:

- `ratioGte(a, b, f)` — `a / b >= f`; IEEE division is correctly rounded,
  so an exact decimal ratio (3.5/5 vs 0.70) compares exactly.
- `countPctGte(count, total, bound)` — integer cross-multiplication;
  student-percentage boundaries (80/60/40, cohort 50) carry no float error.

Displayed values (`pct`, `thresholdMark`) may show float dust; decisions
never use them.

## Testing policy (NFR-7)

`npm test` — vitest, 176 tests. All fixtures are **synthetic, with
expected values worked out by hand** before the assertions were written
(the derivations are in the fixture/test comments — start with
`tests/fixtures/e2eCourse.ts`). No real or sample course data is used as
an oracle. Covered explicitly: every shape and scoring rule, marks exactly
on the threshold, cohort percentages exactly on 80/60/40 and just below,
every §5.1 degenerate case, blank-vs-zero A/B at course level, and courses
with five sectioned tests and with one (nothing assumes two).

The knowledge-level tests (CR-7) treat the college's workbook as a
statement of the **method** and never as an oracle for a number: its
figures are re-derived from first principles here, and one test exists
because the sheet's own `IF(x>79,"3",…)` awards level 3 to 79.5% while
the table printed beside it says 60–79 → 2.

The learner-category tests (CR-8) do the same, and end with a block named
for the faults in the filed *Slow and Advanced Learners* workbook. The
first of them matters beyond this repository: `FinalSem1!I6` is
`=SUM(D10+…)` shared down to `I18`, so thirteen of seventeen students
carry the score of the student four rows below, and the two highest
scorers in the semester are recorded as slow learners. The regression
test builds seventeen students with distinct scores and asserts each one
is its own — a score is reachable only through the student's identity, so
a row offset has nothing to offset.

`npm run typecheck` — strict TypeScript with `noUncheckedIndexedAccess`
and `exactOptionalPropertyTypes`.

## Flagged defaults

`DEFAULT_PARAMETERS.cohortBands` carries the confirmed §4.3 value of
46.7% for the level-1 end-semester cut-off. On a 75-mark paper the
Procedure's integer cut-off was "at least 35", but 35/75 = 46.666…% falls
just below 46.7%, so a student on exactly 35 does not clear it. The
behaviour is pinned by a test; changing the default is a change request
against §4.3.
