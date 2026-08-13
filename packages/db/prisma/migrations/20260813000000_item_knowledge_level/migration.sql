-- CR-7: the learning outcome report by knowledge level.
--
-- A question records the knowledge level it examines, so the paper can be
-- read as a blueprint (what share of the marks asks students to remember,
-- to apply, to analyse) and a student's marks read against it.
--
-- Additive and nullable: every existing question is untagged, the
-- learning-outcome report simply excludes it, and no course changes.
--
-- THIS CANNOT MOVE AN ATTAINMENT FIGURE. CO and PO/PSO attainment are the
-- ten steps of the Procedure and none of them reads this column; the
-- engine computes it in a separate function that computeCourse never
-- calls. A locked snapshot is unaffected — it stores its own inputs and
-- is immutable besides.
ALTER TABLE "Item" ADD COLUMN "bloomLevel" TEXT;

-- The taxonomy is closed, so a typo is caught here rather than surfacing
-- as a question silently missing from the report. Null stays legal: it
-- means "not tagged", which is different from any level.
--
-- These are the six levels of the revised taxonomy in order. The
-- college's own workbook lists five and puts Evaluate before Analyse;
-- the standard order is kept, and the report says so where it matters.
ALTER TABLE "Item" ADD CONSTRAINT "Item_bloomLevel_known"
  CHECK ("bloomLevel" IS NULL OR "bloomLevel" IN
    ('Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'));

-- The report groups a course's questions by level, and mark entry already
-- pulls items by assessment; this makes the grouping cheap without
-- widening any existing index.
CREATE INDEX "Item_bloomLevel_idx" ON "Item" ("bloomLevel") WHERE "bloomLevel" IS NOT NULL;
