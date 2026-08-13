# @copo/export

The departmental Excel workbook for one course (FR-18), built with
exceljs. Depends on `@copo/engine` for types only — it never computes
anything itself.

## The rule this package exists to honour

**Every number is the engine's. Every derived cell is a live formula.**

Each derived cell is written as a formula whose *cached result* is the
engine's value. So:

- the file opens showing the engine's figures, immediately, with no
  recalculation;
- a reader can click any cell and see the arithmetic that produced it,
  and Excel recalculates visibly if they change an input;
- but the spreadsheet is **never** the source of truth. If a formula and
  the engine ever disagree, the formula is wrong.

Leaf cells hold literal inputs — attempted/cleared counts, matrix
strengths, feedback tallies, the parameters — and every formula bottoms
out at those.

## Sheets (in Procedure order)

| Sheet | Contents |
|---|---|
| `Course` | Cover: course, batch, status, engine version, and every engine warning |
| `Parameters` | The thresholds, bands, weights and target **actually applied**, each with the level it was inherited from (institution / programme / course) |
| `Articulation Matrix` | Step 1. Strengths 1–3; unmapped cells left genuinely **empty**, so the weightage `AVERAGE` ignores them |
| one per assessment | Steps 3–4 (and 7): item-wise max, threshold, attempted, cleared, % cleared and level, then the CO roll-up. Cohort-banded assessments get their band table instead |
| `Consolidation` | Steps 5–6: CO rows × assessment columns, then a column per weight group averaging its assessments |
| `Indirect Feedback` | Step 8: n₁/n₂/n₃, N, and the weighted mean |
| `CO Attainment` | Step 9: group levels, direct, indirect, final, target, below-target flag |
| `PO-PSO Attainment` | Step 10: weightage, mean final CO, official figure, and the CO-weighted secondary as a labelled comparison |

Blank ≠ zero throughout: a CO assessed nowhere, an item nobody attempted,
and a PO no CO maps to all come out **empty**, never 0.

## The learning outcome workbook (CR-7)

A **separate** document, built by `buildLearningOutcomeWorkbook` — the
college's *Expected (QP) and Actual* sheets, for one question paper. No
part of the ten steps; see `@copo/engine`'s `computeKnowledgeLevels`.

| Sheet | Contents |
|---|---|
| `Expected (QP)` | The blueprint, laid out as the college's own: questions down, knowledge levels across, each question's marks under its own level, totalled into the expected share of the paper |
| `Attained - Students` | A student per row, with % and level 0–3 per knowledge level. The college's sheet is one student per file; the same figures are gathered into one table here |
| `Attained - Class` | The class roll-up, the absentee count, and the engine's notes |

An absent student's cells are **blank**, not 0 — they did not attain
nothing, they sat nothing.

One quirk worth knowing: exceljs drops a cached formula result of `0` when
writing (it treats it as falsy), so a cell whose value is 0 arrives with
no cached result. Harmless — Excel recalculates it on open, verified by
opening a generated file in Excel — but it is why the tests assert those
cells through their formula rather than a cached value.

## The round-trip test

`npm test` generates the workbook, writes it to a real `.xlsx` buffer,
opens that buffer fresh, and evaluates **every** formula with an
independent evaluator (`tests/formulaEval.ts`) that **never reads a
cached result** — it parses each formula and recursively resolves the
cells it references, bottoming out at literals. The evaluated values are
then asserted against the engine's output to 1e-9.

The test was verified by mutation: swapping the direct/indirect weights
in the Step 9 formula (leaving the cached engine value correct) makes
four assertions fail, including the propagated PO mean. So the test
genuinely re-derives rather than reading back what was written.

It also asserts the engine still reproduces the figures worked out by
hand in the engine's own fixture (finals 2.115 / 2.05 / 2.21; PO1
official 17/9, secondary 2.134375), tying the workbook to a
known-correct computation rather than to whatever the engine emits.

## Known limitation

The layout follows the Procedure's ten steps and the requested sheet
list. **The actual departmental workbook file was not available** in
`docs/`, so column order and labels are a faithful reconstruction, not a
byte-for-byte match. Share the real file and the sheets can be aligned
to it exactly — the formula graph and the test would not change.
