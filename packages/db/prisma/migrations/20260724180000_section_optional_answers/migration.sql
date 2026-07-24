-- AlterTable
ALTER TABLE "Section" ADD COLUMN     "optionalAnswerCount" INTEGER;


-- "answer any n of m": n must be positive when set (0 optional questions is
-- "all compulsory", expressed as NULL). Upper bound (n ≤ item count) spans
-- rows and is enforced in the application and the anomaly report.
ALTER TABLE "Section" ADD CONSTRAINT "Section_optionalAnswerCount_positive"
  CHECK ("optionalAnswerCount" IS NULL OR "optionalAnswerCount" >= 1);
