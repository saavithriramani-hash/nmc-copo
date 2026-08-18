-- CR-8 follow-up: a rating row means a judgement that EXISTS.
--
-- The table allowed a null score, which made "not rated" representable
-- two ways: no row, or a row holding nothing. The engine has always
-- treated those two as one fact, so the second was pure noise -- and it
-- was not harmless. Anything counting rows counted a blank as a rating,
-- so typing a figure into a criterion and then clearing it left that
-- criterion permanently undeletable, with the screen reporting a
-- judgement nobody had made.
--
-- The write path now deletes a cleared rating instead of storing a null.
-- This closes the door behind it, so no future path can reopen it.

-- Rows a cleared cell left behind. They carry no judgement by
-- definition, so there is nothing to preserve.
DELETE FROM "LearnerRating" WHERE "score" IS NULL;

ALTER TABLE "LearnerRating" ALTER COLUMN "score" SET NOT NULL;
