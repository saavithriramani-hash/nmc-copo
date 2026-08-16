# CO–PO Attainment Application — Requirements Specification

**Version:** 1.0 (CONFIRMED — basis for implementation)
**Date:** 23 July 2026
**Institution:** Nehru Memorial College (Autonomous), Puthanampatti
**Governing procedure:** `CO-PO_Attainment_StepByStep_Procedure.docx` ("the Procedure")

All open decisions are settled. This version is the basis for implementation; changes from here are change requests against a baseline, not draft revisions.

### Decisions

| | Decision |
|---|---|
| Scope | College-wide, all departments; hosted multi-user |
| Threshold | `mark ≥ 70% of item maximum`, uniform across all assessment types |
| CO roll-up | Section results averaged within a sectioned test |
| Rubric bands | `≥80 → 3`, `≥60 → 2`, `≥40 → 1`, else `0` |
| Authentication | Local accounts now, designed for later Google Workspace SSO |
| External marks | Total end-semester marks only |
| Hosting | College server, Docker, low-maintenance |
| Migration | Out of scope |
| Scale | 30 programmes, 4,000 students, 8 courses per student per semester |
| Weight groups | Quizzes and seminars share the 0.10 continuous group with assignments |
| Validation | Synthetic fixtures with hand-computed expected values; no sample data used as an oracle |

---

## 1. Purpose

A single institutional system that captures question-wise marks once for every course in the college, executes the Procedure's ten steps identically everywhere, and produces accreditation-ready outputs at course, programme and institution level. The Excel workbook remains an export format, not the working medium.

---

## 2. Users, roles and permissions

> **CR-1 (30 July 2026) — change request against the confirmed baseline.** The role table below supersedes the one issued with v1.0. Three changes, at the college's instruction: the *programme coordinator* is removed and its capabilities pass to the HoD, who is responsible for every programme of their department; *IQAC* becomes read-only; and *Dean* separates from *Principal* as its own role, taking the institution-parameter authority IQAC formerly held. Implemented by migration `20260730000000_roles_dean_and_no_coordinator`, which **deletes** existing coordinator assignments — that role history does not survive the change.

> **CR-2 (31 July 2026) — change request against the confirmed baseline.** The HoD may **create, rename and delete batches** in the programmes of their own department; previously only the system administrator could, so a HoD had to request the container before importing the cohort's roster (FR-10) into it — and again to correct a mistyped year. The capability is **added, not moved**: the administrator keeps it, because academic-year rollover creates batches and a department between HoDs must not be stranded. Implemented as a new department-scoped action `batches.manage` rather than by widening `departments.manage` — managing a batch must not carry the power to create or destroy departments and programmes, which remain administrative. Deletion is unchanged in substance: it still refuses while any course or roster entry references the batch, naming them, and is never a cascade. No migration: this is a policy change only, and no role assignment or stored row changes.

> **CR-3 (5 August 2026) — change request against the confirmed baseline.** A **Controller of Examinations** is added, institution-wide, and takes what the examinations office owns in practice: the **course catalogue** (creating courses, and their code, title, semester and credits), **batches**, **student rosters**, and the **external examination** — its assessment structure, its marks, and an institution-wide template for its pattern. Courses may now be flagged **Laboratory**; a practical paper carries its own course code and its external examination is conducted by the department, so for those the HoD and the course faculty hold the external assessment and its marks instead. The flag changes **no arithmetic** — the ten steps, the weight groups and every attainment figure are identical either way — and it cannot be changed once external marks exist, because that would transfer ownership of work already recorded. This **supersedes CR-2 on batches**: batches and rosters move together to the COE, which is the same reasoning CR-2 gave, now pointing at the examinations office. The HoD keeps everything about running a course — staffing, outcomes, matrices, internal and continuous marks, approval and locking — and a LOCKED course remains closed to the COE, who cannot unlock it. Implemented by migrations `20260805000000_coe_role_kind` and `20260805000100_coe_scope_and_laboratory_courses`; additive, with every existing course becoming a theory course.

> **CR-4 (12 August 2026) — change request against the confirmed baseline.** The review had one outcome: approve. A HoD who wanted a correction had to say so outside the system, leaving no record of what was asked or whether it was done, and the approval that followed carried no trace of the query behind it. Two additions. First, the HoD may **send a submission back with a written reason**, which is required, at least five characters, and returns the course to DRAFT so its faculty can act on it; only the HoD may write one, and it is never edited afterwards. Second, every submission becomes a **review round** — who submitted it, what was decided, when, by whom, and the version an approval produced — shown as the course's review history and surfaced on a new **role-aware dashboard** (FR-24) that replaces the course list as the landing page. The dashboard reports counts and statuses only and computes no attainment. Implemented as a new course action `course.return`, held by the HoD alone and only while a course is SUBMITTED, and migration `20260812000000_course_submissions`; additive, with courses submitted or locked before this change gaining a round at their next transition. No attainment figure, weight or threshold changes.

> **CR-5 (12 August 2026) — change request against the confirmed baseline.** The Controller of Examinations may **create, rename and delete departments and programmes**. CR-3 gave the examinations office the batches, the courses and the rosters but stopped short of the tree they hang from, so adding a programme still meant asking the system administrator — an administrative errand in the middle of academic work, and the same friction CR-2 identified for batches. The capability is **added, not moved**: the administrator keeps it, because academic-year rollover creates structures and a college between Controllers must not be stranded. **Creating the institution record does not travel with it.** That record seeds the institution attainment parameters (§4.2–§4.4), and CR-1 made the Dean the only role that sets those, so it is split off as `institution.create` and stays with the administrator, who performs it once at deployment. Deletion is unchanged in substance: a department still refuses while it holds programmes, roles or templates, a programme still refuses while it holds batches, each naming its blockers, and neither is ever a cascade. No migration: this is a policy change only, and no role assignment or stored row changes.

| Role | Scope | Capability |
|---|---|---|
| **Faculty** | Own courses | Course setup, mark entry, compute, export, submit for approval; the external examination of **Laboratory** courses they teach |
| **HoD** | Own department, all its programmes | All faculty capability department-wide; POs/PSOs and articulation matrices; programme- and course-level parameter overrides; approve and lock courses, or **send a submission back with a written reason** (CR-4); department consolidation; the external examination of **Laboratory** courses |
| **Controller of Examinations** | Institution | **Departments and programmes** (CR-5); the course catalogue — creating courses, and their code, title, semester, credits and the Laboratory flag; batches; student rosters; the **external examination of theory courses** (structure and marks) and the institution-wide template for it. **No access to internal or continuous marks**, none to a locked course, and none to the institution attainment parameters |
| **Dean** | Institution | Read-all; institution consolidation; accreditation bundles; **sets the institution attainment parameters (§4.2–§4.4)**; audit log |
| **IQAC / Accreditation cell** | Institution | **Read-only.** Read-all; institution consolidation; accreditation bundles; audit log. Sets nothing |
| **Principal** | Institution | Read-only dashboards |
| **System administrator** | Institution | Accounts, departments and programmes (shared with the COE since CR-5), the institution record at installation, academic-year rollover, backups |

Faculty see only their own courses. A locked course is editable only by the HoD or above, and unlocking creates a new version rather than overwriting. Role assignments carry effect dates, because staff change hands between accreditation cycles and the file must still record who computed what.

The Head of Department is the **only** role carrying a scope; every other role is institution-wide. Raw per-student marks remain restricted to the course faculty and their department chain — **and, since CR-3, to the Controller of Examinations, who enters the end-semester marks and cannot do so blind** (NFR-10). Neither Dean, IQAC, Principal nor administrator can reach them, and the two institution-wide read-all roles differ by exactly one action: `settings.institution.write`, which the Dean alone holds.

The COE's reach into marks is bounded at the point of use rather than by role: the mark screens serve one assessment at a time and demand `marks.external.write` to open one, so a theory course's internal tests and assignments never appear to them. **CR-3 also gives the COE the student register institution-wide**, since rosters moved with batches — a wider holding of register numbers, names and email addresses than any single HoD had.

### 2.1 Authentication

Local accounts in Phase 1: administrator-created, hashed passwords, forced first-login change, password reset by the administrator.

**Built for migration from day one.** Each user carries an `identity_provider` field (`local` initially) and a stable internal user ID that is never the email address. Authentication sits behind a single interface with one implementation now and an OIDC implementation later. When the college moves to Google Workspace, existing accounts are matched by email and re-pointed — no re-creation, no loss of audit history, no change to any other part of the system.

---

## 3. Domain model

```
Institution
└── Department (e.g. Mathematics)
    └── Programme (e.g. B.Sc. Mathematics)
        ├── PO / PSO definitions (own set per programme)
        ├── Attainment parameters (inherited from institution, overridable)
        └── Batch (e.g. 2024–2027)
            └── Course (e.g. Semester III, Real Analysis)
                ├── CO definitions (statement + Bloom level)
                ├── CO–PO/PSO articulation matrix
                ├── Course parameter overrides
                ├── Enrolment (from the batch roster)
                ├── Assessment [0..n]  ← see §3.1
                ├── Indirect feedback (CO-wise, 3-point)
                └── Attainment snapshot (versioned, immutable once locked)
```

Two structural rules the workbook could not enforce:

- **One roster per batch, shared by every course that batch takes.** A register number is entered once per batch, not once per course, which makes internal and external marks joinable per student by construction.
- **Blank is not zero.** Blank means "did not attempt" and is excluded from the denominator; zero means "attempted, scored nothing" and is included. Distinct at entry, distinct in the database.

### 3.1 Assessment model

A course declares any number of assessments. Each has a name, a **shape**, a **scoring rule**, and a **weight group**.

**Shapes**

| Shape | Structure | Typical use |
|---|---|---|
| `SECTIONED` | Sections → questions; each question has a maximum, a CO tag, and an optional "answer any *n* of *m*" rule | CIA / internal tests |
| `ITEM_LIST` | A flat list of items; each has a maximum and a CO tag. No sections | Quiz, multi-part assignment |
| `SINGLE_SCORE` | One score with a maximum and one or more CO tags | Seminar, viva, project, a one-mark-total assignment, end-semester |

Sections are user-defined — named freely, any number, not fixed to A–D. A course may have one internal test or five; the engine does not assume two.

**Scoring rules**

| Rule | Method |
|---|---|
| `RUBRIC` (default) | Per item: % of students clearing the 70% threshold → band table → level 0–3 |
| `COHORT_BAND` | The Procedure's Step 7 rule, applied to a total score — see §4.3. Used by the end-semester assessment |

**Weight groups** — see §4.4.

**CO tagging is optional.** An assessment or item with no CO tag contributes its level to **every** CO in the course, which is how the Procedure treats assignments today. A tagged assessment contributes only to the COs named.

---

## 4. Attainment parameters

Institution defaults, overridable per programme, and per course where the Academic Council has minuted an exception. Every applied override appears on the course report, so an auditor can see which rule produced the number.

### 4.1 Item threshold
`attained ⟺ mark ≥ 0.70 × item maximum`, the fraction overridable. For a 1-mark item this means any non-zero mark, matching Step 2.

### 4.2 Attainment bands

| Students clearing the threshold | Level |
|---|---|
| ≥ 80% | 3 |
| ≥ 60% | 2 |
| ≥ 40% | 1 |
| below 40% | 0 |

An editable table of (lower bound, level). Levels numeric throughout.

### 4.3 End-semester bands (Step 7)
Level 3 if ≥ 50% of students score ≥ 60% of the paper maximum; else 2 at ≥ 53.3%; else 1 at ≥ 46.7%; else 0. Stored as percentages of the maximum, so a 100-, 75- or 50-mark paper works unchanged. **Total end-semester marks only** — no question-wise external decomposition.

### 4.4 Weight groups (Step 9)

The Procedure's Step 9 names three direct components. Generalised, each assessment is assigned to a weight group, and group weights are validated to sum to 1.00:

| Group | Default weight | Default membership |
|---|---|---|
| Internal | 0.20 | Sectioned internal tests |
| Continuous | 0.10 | Assignments, quizzes, seminars |
| External | 0.70 | End-semester |

Then `Final = 0.9 × Direct + 0.1 × Indirect`.

Quizzes and seminars have no weight of their own in the Procedure. **Decision:** they join assignments in the continuous group, so the 0.10 share is split across whatever a course actually conducts — a course running an assignment, a quiz and a seminar averages all three into that 0.10. This accommodates the new assessment types without altering the Procedure's published weights, and keeps departments running different mixes comparable. Group weights remain configurable if the Academic Council later minutes a change.

### 4.5 Target attainment
Configurable per programme, default **2.5**. Every CO below target is flagged and a gap-analysis stub is generated for the faculty to complete. This interprets the ten steps; it does not alter them.

---

## 5. Calculation engine

A pure, side-effect-free module: marks and parameters in, the full attainment chain out. No database access, no UI concerns. This is the asset — independently testable, and independently reviewable by anyone questioning a number in an audit. Step numbers map to the Procedure.

**Step 1 — Articulation matrix.** CO↔PO/PSO correlation as 1/2/3. `weightage(PO_j)` = mean of the CO mapping strengths for that PO/PSO.

**Step 2 — Thresholds and rubric.** Resolved institution → programme → course.

**Step 3 — Score every item.** For each item *i* in a `RUBRIC` assessment: `attempted` (non-blank marks), `cleared` (marks ≥ threshold), `pct = cleared/attempted × 100` guarded against a zero denominator, `level` from the band table.

**Step 4 — Aggregate items to each CO within an assessment.**

- `SECTIONED`: `level(section, CO)` = mean of item levels in that section tagged to that CO; then `level(assessment, CO)` = mean across **all sections in which the CO appears**.
- `ITEM_LIST`: `level(assessment, CO)` = mean of item levels tagged to that CO. No section layer.
- `SINGLE_SCORE` with `RUBRIC`: the single score is scored as one item; its level applies to each tagged CO.
- `SINGLE_SCORE` with `COHORT_BAND`: level from §4.3, applied to each tagged CO — or to all COs if untagged, as the end-semester assessment is.

**Step 5 — Consolidate within each weight group.** `level(group, CO)` = mean of `level(assessment, CO)` across the assessments in that group **in which the CO appears**. A CO assessed in one internal test carries that test's value; a CO in three carries their mean. This is Step 5 generalised from two tests to any number.

**Steps 6 & 7 — Continuous and external groups.** Both fall out of Step 5: the continuous group averages the assignments, quizzes and seminars; the external group is the single end-semester assessment.

**Step 8 — Indirect attainment.** `indirect(CO) = (1×n₁ + 2×n₂ + 3×n₃) ÷ N` from the 3-point feedback scale.

**Step 9 — Final CO attainment.**
`direct(CO) = Σ_groups weight(group) × level(group, CO)`
`final(CO) = 0.9 × direct(CO) + 0.1 × indirect(CO)`
With the default configuration this is exactly the Procedure's `0.2 × Internal + 0.1 × Assignment + 0.7 × External`. The internal figure enters at full value — no intermediate averaging.

**Step 10 — Project onto POs and PSOs.**
`PO_j = weightage_j × (mean final CO attainment) ÷ 3` — the Procedure's method, and the official figure. The CO-weighted alternative `PO_j = Σᵢ(Mᵢⱼ × finalᵢ) ÷ Σᵢ Mᵢⱼ` is computed alongside as a secondary column for comparison.

### 5.1 Degenerate cases the engine must handle explicitly

Each returns a defined result and a warning, never a crash or a silent zero: a CO assessed in no assessment; an item nobody attempted; a weight group with no assessments (its weight redistributes proportionally, and the report says so); an assessment with no CO tags anywhere; fewer feedback responses than a configured floor; a course with no indirect data (direct-only, flagged).

---

## 6. Functional requirements

### 6.1 Institution and programme setup
- **FR-1** Manage departments, programmes, batches, academic years; roll over to a new academic year without re-entering structure.
- **FR-2** Define PO/PSO sets per programme, with statements.
- **FR-3** Set attainment parameters at institution, programme or course level, with the inheritance visible.

### 6.2 Course and assessment setup
- **FR-4** Create a course: code, title, semester, batch, credits, assigned faculty.
- **FR-5** Define COs with statement and Bloom's level.
- **FR-6** Articulation matrix grid (1–3, blank = unmapped); weightages computed live.
- **FR-7** Define any number of assessments, each with a shape, scoring rule, weight group, maximum and CO tags; sectioned assessments get user-named sections and per-question configuration.
- **FR-8** **Assessment templates.** A department defines reusable patterns — "two CIAs, four sections, quiz, seminar" — and a course adopts one in a click, then adjusts. With roughly 700 course instances a semester, this is the single largest time saving in the system.
- **FR-9** Clone a full course setup from a previous batch or another course.

### 6.3 Roster and marks
- **FR-10** Import batch rosters from Excel/CSV; courses draw enrolment from the batch roster.
- **FR-11** Mark entry grid: students down, items across, keyboard-navigable, blank ≠ zero, validated against the item maximum, auto-saving, resumable.
- **FR-12** Paste or upload marks for one assessment from a spreadsheet, matched on register number, with a preview of what will change before it is applied.
- **FR-13** Pre-calculation anomaly report: marks over maximum, more optional questions attempted than permitted, students with no marks in an assessment, items with no attempts, COs assessed nowhere, feedback below the response floor.

> **CR-7 (13 August 2026) — change request against the confirmed baseline.** The examinations office's *Learning Outcome (Expected (QP) and Actual)* workbook becomes a report of the system (FR-25). A question may record the **knowledge level** it examines, and from that a paper is read twice: as a blueprint — the share of its marks asking the student to remember, understand, apply, analyse, evaluate or create, which stands before the examination is held and tells the paper-setter whether the paper matches the balance intended — and as attainment, each student's marks against those allotments, banded 0–3 by the §4.2 table, with a class roll-up. **Standalone**: it is computed by a separate engine function that `computeCourse` never calls, no CO or PO figure reads it, and the ten steps do not know it exists. Four decisions worth recording. **(a)** The tag sits on the *question*, not the CO: `CourseOutcome.bloomLevels` describes what an outcome spans, this describes what a question asks, and they are different judgements. **(b)** The denominator is the marks the paper **allotted**, not the marks attempted — the one place in the system where a blank stays in the denominator, because an outcome not demonstrated is not an outcome attained; blank is still not zero, so unattempted marks are reported separately, a student who attempted nothing is *absent* rather than scoring nothing, and the class figures exclude them. **(c)** Any assessment carrying items may be tagged; the end-semester paper is stored as a single total (§4.3), so it has no questions to tag and this changes nothing about §4.3. **(d)** The six standard levels are kept in taxonomy order, where the college's sheet lists five and puts Evaluate before Analyse. Four faults in the source workbook are corrected and covered by regression tests: the attainment level is a **number**, not the text `"3"`; the band boundary is `≥80` where the sheet's `>79` awards level 3 to 79.5%; a level the paper does not examine yields a defined result instead of `#DIV/0!`; and the final `IF` has no fall-through. Implemented by migration `20260813000000_item_knowledge_level` — one nullable column, so every existing question is untagged and no course changes.

### 6.4 Calculation, review, approval
- **FR-14** Compute on demand; drill down from any PO figure to the individual item.
- **FR-15** Every figure explains itself — expanding a value shows its inputs, its arithmetic, and the Procedure step it implements.
- **FR-16** Submission workflow: faculty submits → HoD reviews and **either sends back with a required written reason, or locks** → immutable versioned snapshot. Unlocking creates a new version. Every submission is a **review round**, retained with who submitted it, what the HoD decided, when, and — where it was sent back — why; the exchange is shown on the course as its review history and is never edited afterwards. *(Amended by CR-4.)*
- **FR-17** Full audit log: who changed what, when, and the prior value.
- **FR-24** A role-aware dashboard at the landing page, showing each user what is waiting on them: courses sent back with the HoD's comment, the HoD's approval queue oldest-first, department and catalogue readiness, external examinations not yet set up or marked, and whole-college status counts for the read-only roles. It reports **counts and statuses only, never attainment** — attainment is recomputed from every mark in a course, and a page listing thirty courses cannot run the engine thirty times. *(Added by CR-4.)*

- **FR-25** Learning outcome by knowledge level, per question paper: the paper's **blueprint** (the share of its marks asking the student to remember, understand, apply, analyse, evaluate or create), each student's marks read against those allotments and banded 0–3, and the class roll-up. A standalone report — it computes no CO or PO attainment and none of the ten steps reads it. *(Added by CR-7.)*

> **CR-8 (16 August 2026) — change request against the confirmed baseline.** The department's *Slow and Advanced Learners* workbook becomes a report of the system (FR-26), for **NAAC 2.2.1**. Each subject rates a student on criteria the programme defines — the Mathematics department uses four a teacher judges (interaction with teachers, flipped learning, seminar, interest in self-learning) and one derived from the marks; each criterion is averaged across the semester's subjects, the averages summed, and the student classified from a band table. **Standalone**, on the same terms as CR-7: a separate engine function that `computeCourse` never calls, no CO or PO figure reads it, and the ten steps do not know it exists.
>
> Six decisions worth recording. **(a)** The criteria are held **per programme**, not built in: the five in the filed workbook are one department's choice and thirty programmes will not agree on them. **(b)** The "Weightage (20) CIA & semester" column is **derived, never typed** — total marks earned over the marks the subject's papers allot, scaled to the criterion maximum. Every value in the filed column is a multiple of 0.2 on a 20-point scale, which fixed the definition; it was retyped by hand there and is counted here. **(c)** A student whom **no teacher has judged is left unclassified**, however good their marks. The derived criterion always has a value once marks exist, so without this rule every unjudged student in the college would be labelled from their mark percentage alone — a percentage wearing a category name. **(d)** Blank is not zero, and here it bites hardest: an unrated criterion leaves the numerator *and* the divisor, and the obtainable total shrinks with it, so a half-filled sheet cannot push a student towards "slow learner". **(e)** The named roll follows **NFR-10** and stops at the department chain; the Dean, IQAC and Principal keep the counts and the distribution, which name nobody. **(f)** The ratings stay editable on a **locked** course — the only course-scoped write that does — because they enter no snapshot and feed no attainment figure, while the 2.2.1 return is prepared months after attainment is locked.
>
> **Seven faults in the filed 2023–2026 workbook are corrected, each covered by a regression test.** The most serious: `FinalSem1!I6` is `=SUM(D10+E10+F10+G10+H10)`, shared down to `I18`, so **thirteen of seventeen students display the score of the student four rows below** — the two highest scorers in the semester are on file as slow learners and two of the weakest as advanced. Beside it: the category is typed by hand and 84.6 appears as both "SL" and "AL" in one sheet; two rows of `FinalSem2` have their formulas overtyped with one subject's raw values; one cell alone is wrapped in `ROUND(...,0)`; `=SUM(a+b)/2` counts a subject the student never took as a zero; the divisors are hard-coded and the sheets named `Sheet1`…`Sheet5`; and with only two categories, 76% of the Semester 1 cohort is recorded as slow. **The department should be told about the first of these independently of this build — the record on file today is wrong and may already have been submitted.** Implemented by migration `20260816000000_learner_categories` — two new tables and two nullable columns, purely additive, nothing existing read or rewritten.

### 6.5 Reports and exports

> **CR-6 (12 August 2026) — change request against the confirmed baseline.** The course report is also produced as a **Word document**, beside the existing PDF and Excel. The baseline gave the faculty two formats, neither of which they can write in: §4.5 asks for an action plan against every CO below target, so the plan was written on a printout or the report was retyped into Word to be folded into a NAAC or NBA submission. The Word version carries **identical content and identical figures** — both renderers read one data structure and format every number through the same helper, and a test asserts that every figure in the Word file also appears in the PDF, so the two documents cannot disagree about an approved result. **The charts are in the PDF only**; they are vector drawings, and carrying them across would mean rasterising images inside the container, against NFR-5. Every figure they depict is in the tables, and the Word document states in words where each chart stands in the PDF. **The PDF remains the filed document**: it is the one that paginates for A4, carries the running header on every page, and is generated for the accreditation bundle (FR-22), which is unchanged. No migration, no permission change — the Word route is guarded by `course.read`, exactly as the PDF is, and logs the same audit action with the format recorded.

- **FR-18** Excel export in the departmental workbook layout, with live formulas. *(Built first.)*
- **FR-19** PDF course report: details, CO statements, articulation matrix, item-wise analysis, CO attainment, PO/PSO attainment, gap analysis and action plan. **The same report is also produced as a Word document (CR-6)** — identical content and identical figures, editable, so the faculty can write the §4.5 action plan into it and fold the report into a NAAC or NBA submission. The PDF remains the filed document and is the only version carrying the charts.
- **FR-20** Programme-level consolidation: PO/PSO attainment across every course in a semester or batch.
- **FR-21** Institution-level consolidation for the IQAC, by department and programme.
- **FR-22** Accreditation bundle: every course report, the consolidations, and the Procedure appendix populated with the parameters actually used.
- **FR-23** Charts: CO attainment bars, PO/PSO spider, target-vs-achieved, trend across batches.
- **FR-26** Slow and advanced learners (NAAC 2.2.1), per batch and semester: the criteria a programme rates on, entered per subject beside a weightage derived from the marks; each criterion averaged across the semester's subjects and summed; the student classified from an editable band table resolved institution → programme. Exported as the college's own layout — a sheet per subject and a semester sheet — with live formulas. A standalone report: it computes no CO or PO attainment and none of the ten steps reads it. The named roll is the department chain's; the counts name nobody. *(Added by CR-8.)*

---

## 7. Scale and load

| Quantity | Estimate |
|---|---|
| Programmes | 30 |
| Students | 4,000 |
| Enrolments per semester | ~32,000 (4,000 × 8) |
| Course instances per semester | ~700 |
| Faculty accounts | ~300 |
| Mark values per semester | ~2–3 million |
| Retained over a five-year cycle | ~25–30 million |

Consequences for the design, all of which must be built in from the start rather than retrofitted:

- **NFR-1** Mark values live in a single indexed table; no query loads a whole course's marks into application memory to compute a summary.
- **NFR-2** Course computation is fast enough to feel instant. Programme and institution consolidations run as background jobs with a progress indicator, not as blocking requests.
- **NFR-3** The system must stay responsive with several hundred faculty entering marks in the same week. Mark entry saves incrementally and survives a dropped connection without losing a screen of work.
- **NFR-4** Bulk operations — roster import, academic-year rollover, accreditation bundle export — run in the background and are restartable.

---

## 8. Other non-functional requirements

- **NFR-5 Deployment.** Docker Compose on a college server: application, PostgreSQL, and a backup sidecar. One command to deploy, one to upgrade, one to restore. No Kubernetes, no microservices, no external service dependencies — the IT staff should be able to run this without learning a new discipline.
- **NFR-6 Backup.** Automated nightly database dump, retained for at least one full accreditation cycle. Copies written to a second location on campus. A documented and *tested* restore procedure — an untested backup is not a backup.
- **NFR-7 Correctness.** The engine ships with a test suite built on **synthetic fixtures with hand-computed expected values**, covering each shape, each scoring rule, the degenerate cases in §5.1, and the boundary conditions (a mark exactly on the threshold, a percentage exactly on 80/60/40). No real or sample course data is used as an oracle.
- **NFR-8 Usability.** Usable by faculty comfortable with Excel and nothing more. Tamil interface labels as a later option.
- **NFR-9 Auditability.** Every number traceable to its inputs and to a Procedure step; every edit logged with user and timestamp.
- **NFR-10 Security.** Role-based access; marks visible only to the course faculty and their department chain — **and, per CR-3, to the Controller of Examinations for assessments in the external weight group only**; hashed passwords; HTTPS enforced; session timeout.
- **NFR-11 Concurrency.** Two people editing the same course must not silently overwrite each other.
- **NFR-12 Data portability.** Full institutional export in open formats at any time. The college is never locked in.

**Technology:** TypeScript (Next.js) with PostgreSQL, containerised, with the ten-step engine as a standalone dependency-free module. One language across the system, an engine that can be lifted out and re-verified independently, and a stack that is straightforward to hand to a maintainer.

---

## 9. Arithmetic faults to guard against

Drawn from the sample workbook's formulas. The data there is fictitious, so none of these are errors in a real result — but each is a mistake the spreadsheet approach invites, and each becomes a regression test.

| Fault | Guard |
|---|---|
| An intermediate averaging step not in the Procedure (`(Internal + Assignment)/2`) silently halving a component | Step 9 implemented once, from the weight table |
| A ratio computed upside down (`cleared/attempted` inverted), yielding percentages above 100 | Percentages asserted to lie in [0, 100]; violation is an error, not a warning |
| Hard-coded numbers sitting where formulas should be, so figures stop responding to mark edits | No stored derived values; everything computed from marks on demand |
| A component averaged over four sections in one test and three in another | Step 5 averages over the sections in which the CO appears, uniformly |
| Attainment levels returned as text `"3"` but numeric `2`, `1`, `0`, so averages silently mistype | Levels are integers, enforced by the type system |
| Band boundaries written as `>79` against a rubric that says 80 | Bands are a single table of lower bounds, used everywhere |
| References pointing at empty cells and yielding zero | Missing inputs raise an explicit warning; never coerced to zero |
| A weightage hard-coded to a value that happens to be correct today | Weightages always derived from the current matrix |
| Register numbers that differ between internal and external sheets, making marks unjoinable per student | One roster per batch; marks reference an enrolment, never a typed string |
| Blank and zero indistinguishable | Distinct at entry, distinct in storage, distinct in the denominator |

---

## 10. Phasing

**Phase 1 — engine and pilot.** Programme/course/assessment setup, mark entry, the ten steps, Excel export, local accounts. Mathematics as the pilot department.
**Phase 2 — the college.** All departments, roles and approval workflow, programme and institution consolidation, PDF reports, accreditation bundle.
**Phase 3 — refinement.** Google Workspace SSO, trend analysis across batches, curriculum gap analysis, Tamil interface.

Out of scope throughout: legacy workbook migration, attendance, internal mark submission to the university, timetabling, LMS integration, student-facing views.

---

## 11. Deliverables

1. This requirements document, confirmed.
2. A Claude Code prompt generated from it — repository scaffold, schema, ten-step engine with tests, assessment and mark-entry UI, exporters, deployment.
