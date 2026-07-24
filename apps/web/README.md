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
| `/` | Courses scoped like the Guard scopes them (own / department / programme) |
| `/admin/departments` | Admin: institution bootstrap (engine defaults), departments, programmes |
| `/programmes/[id]` | Coordinator edits PO/PSOs; admin adds batches |
| `/courses/new` | HoD creates a course (`course.create`, server-derived department) |
| `/courses/[id]` | Details + assigned faculty |
| `…/outcomes` | CO editor (code, statement, Bloom level, reorder) |
| `…/matrix` | COs down, POs/PSOs across, cells 1/2/3/blank. **Weightages recompute live under each column via the engine's own `step1ArticulationWeightages`** — what faculty see while typing is what the report computes |
| `…/assessments` | List + add (any shape/rule/group) + **adopt template** + **clone setup** + save-as-template (HoD) |
| `…/assessments/[id]` | Structure editor: unlimited user-named sections, item tables with per-item CO tags, single-score CO tag checkboxes |
| `/templates` | HoD: department templates with structure summaries |

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
#   admin@nmc.dev, hod.math@nmc.dev, faculty1@nmc.dev, faculty2@nmc.dev, coord.math@nmc.dev
```

Verified without a database: 8 plan-logic tests, full typecheck, and a
clean `next build` (all routes compile; auth pages static, everything
else dynamic). Not yet verified: live browser flows against a running
Postgres — this machine has no Docker; exercise the seed + login + setup
flows on a machine that does.
