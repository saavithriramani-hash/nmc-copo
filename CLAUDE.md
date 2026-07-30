# CLAUDE.md

CO–PO attainment application for **Nehru Memorial College (Autonomous), Puthanampatti** — an autonomous college in Tamil Nadu. It computes Course Outcome (CO) and Programme Outcome (PO/PSO) attainment from question-wise student marks and produces accreditation-ready outputs at course, programme and institution level, for **NAAC and NBA** filing. It replaces a departmental Excel workbook; Excel stays an *export format*, not the working medium.

## Source of truth — read before any non-trivial work

- **`docs/COPO_App_Requirements_v1.0.md`** — CONFIRMED requirements, the implementation baseline. All decisions are settled; further changes are change requests against a baseline, not draft revisions.
- **`docs/CO-PO_Attainment_StepByStep_Procedure.docx`** ("the Procedure") — the college's official ten-step method that governs every calculation. Engine step numbers map to it.

Read both before touching the engine, the schema, or any attainment number. Do not infer the mathematics from code alone. `§n` references below point into the requirements document.

## Stack

TypeScript end to end. **Next.js (App Router)**, **PostgreSQL**, **Prisma**, **Tailwind**. **Docker Compose** (app + Postgres + backup sidecar) on a single college server maintained by **non-specialist IT staff**: one command to deploy, one to upgrade, one to restore. No Kubernetes, no microservices, no external service dependencies.

## Scale — design for this from the start; do not retrofit

30 programmes · 4,000 students · ~700 course instances/semester · ~32,000 enrolments/semester · ~2–3M mark values/semester · **~25–30M mark values retained over a five-year accreditation cycle**. Marks live in one indexed table; **no query loads a whole course's marks into application memory** to compute a summary. Course compute must feel instant; programme/institution consolidations and bulk ops (roster import, academic-year rollover, bundle export) run as **restartable background jobs**, never blocking requests.

## Architecture — the rule that matters most

The calculation engine (**`packages/engine`**) is **pure TypeScript with zero runtime dependencies**: no database access, no framework imports, no I/O. Marks and parameters in, attainment out. It must be **liftable out of this repository and verifiable on its own**, because an accreditation auditor may question any number it produces. All DB/UI/framework code lives *outside* the engine and calls into it; the engine is a standalone workspace package the app depends on.

## Invariants — must hold everywhere (UI, database, engine)

- **Blank ≠ zero.** A blank mark means "did not attempt" → **excluded from the denominator**. A zero means "attempted, scored nothing" → **included**. Distinct at entry, in storage, and in the engine.
- **Attainment levels are integers 0–3.** Never strings. (Text `"3"` vs numeric `2` silently mistyping averages is a known workbook fault.)
- **Percentages are asserted to lie in [0, 100].** A violation is a **thrown error**, not a warning.
- **No derived value is ever stored** — except inside an **immutable snapshot of a locked course**. Everything else is computed from marks on demand.
- **Missing inputs are never silently coerced to zero.** They produce an explicit, surfaced **warning**.

## The ten steps (engine — maps 1:1 to the Procedure)

1. **Articulation matrix** CO↔PO/PSO as 1/2/3. `weightage(PO_j)` = mean of the CO strengths mapped to it. Always derived from the current matrix — never hard-coded.
2. **Thresholds & rubric**, resolved institution → programme → course.
3. **Score each `RUBRIC` item:** `attempted` (non-blank), `cleared` (≥ threshold), `pct = cleared/attempted × 100` (guard the zero denominator), `level` from the band table.
4. **Items → CO within an assessment.** `SECTIONED`: mean of item levels per section, then mean across the sections in which the CO appears. `ITEM_LIST`: mean of tagged item levels, no section layer. `SINGLE_SCORE`: the one score scored as a single item (RUBRIC) or cohort-band (§4.3), applied to each tagged CO — or to all COs if untagged.
5. **Consolidate within each weight group:** `level(group, CO)` = mean of `level(assessment, CO)` across the assessments **in which the CO appears** (Step 5 generalised from two tests to any number).
6 & 7. **Continuous & external groups** fall out of Step 5. Continuous averages assignments/quizzes/seminars; external = the single end-semester assessment, scored by cohort-band (§4.3).
8. **Indirect:** `indirect(CO) = (1×n₁ + 2×n₂ + 3×n₃) ÷ N` from the 3-point feedback scale.
9. **Final:** `direct(CO) = Σ_groups weight(group) × level(group, CO)`; `final(CO) = 0.9 × direct + 0.1 × indirect`. Implemented **once, from the weight table** — the internal figure enters at full value, no intermediate `(Internal + Assignment)/2` averaging.
10. **Project onto POs/PSOs:** `PO_j = weightage_j × (mean final CO attainment ÷ 3)` — the **official** figure. The CO-weighted variant `Σᵢ(Mᵢⱼ × finalᵢ) ÷ Σᵢ Mᵢⱼ` is computed alongside as a secondary comparison column.

**Degenerate cases (§5.1) are handled explicitly** — each returns a defined result **and a warning**, never a crash or silent zero: a CO assessed nowhere; an item nobody attempted; an empty weight group (its weight redistributes proportionally, and the report says so); assessments with no CO tags; feedback below a response floor; a course with no indirect data (direct-only, flagged).

## Key parameters (institution defaults; overridable programme → course; every applied override is shown on the report)

- **Item threshold:** `mark ≥ 0.70 × item maximum`, fraction overridable, **uniform across all assessment types**. A 1-mark item → any non-zero mark.
- **Attainment bands** (proportion clearing threshold → level): ≥80 → 3, ≥60 → 2, ≥40 → 1, else 0. An editable table of (lower bound, level).
- **End-semester bands (Step 7):** level 3 if ≥50% of students score ≥60% of the paper maximum; else 2 at ≥53.3%; else 1 at ≥46.7%; else 0. Stored as **percentages of the maximum** (so 100/75/50-mark papers work unchanged). **Total end-semester marks only** — no question-wise external decomposition.
- **Weight groups (validated to sum to 1.00):** Internal 0.20 · Continuous 0.10 (assignments **+ quizzes + seminars share this 0.10**) · External 0.70. Then `Final = 0.9 × Direct + 0.1 × Indirect`.
- **Target attainment:** default **2.5** per programme; every CO below target is flagged with a gap-analysis stub.

## Testing policy (NFR-7)

The engine ships with a suite built on **synthetic fixtures with expected values worked out by hand**. **No real or sample course data is ever used as an oracle** (the sample workbook is fictitious). Every boundary gets an **explicit** test: a mark exactly on the threshold; a cohort percentage exactly on 80, 60 and 40; the end-semester boundaries; every §5.1 degenerate case; each shape; each scoring rule. **§9 lists ten spreadsheet faults, each of which becomes a regression test** — consult it when touching the engine.

## Roles, auth, phasing (brief)

- **Roles** (§2 as revised by CR-1, 30 Jul 2026): Faculty (own courses) · HoD (own department **and all its programmes** — approve & lock, POs/PSOs, matrices, programme + course parameter overrides) · Dean (institution read-all, consolidation, bundles, **and the only role that sets the institution attainment parameters**) · IQAC/Accreditation cell (institution **read-only**) · Principal (read-only dashboards) · System admin (accounts, rollover, backups; no academic data). **There is no programme coordinator.** The HoD is the only scoped role; the rest are institution-wide. Faculty see only their own courses; a locked course is editable only by HoD or above; **unlocking creates a new version, never overwrites**.
- **Auth:** local accounts now (hashed, forced first-login change), behind a single interface designed for **later Google Workspace OIDC SSO**. Each user has an `identity_provider` field and a **stable internal user ID that is never the email**.
- **Phasing:** Ph1 — engine + Mathematics pilot (setup, mark entry, ten steps, Excel export, local accounts). Ph2 — all departments, roles/approval, consolidations, PDF, accreditation bundle. Ph3 — SSO, trends, curriculum gap, Tamil UI. Out of scope throughout: legacy migration, attendance, university submission, timetabling, LMS, student-facing views.

## Working agreement

When the requirements are ambiguous, **ask rather than guess.** This is an accreditation system: a plausible invention that produces a wrong number is far worse than a question. Prefer the requirements document and the Procedure over inference; where they are silent or appear to conflict, surface it rather than resolving it silently.
