import type { Prisma } from '@prisma/client';
import type { BandRow, CohortBandRow, ParameterOverrides, Parameters } from '@copo/engine';

/**
 * Parameter cascade (§4): the institution row carries the complete
 * parameter set (all columns NOT NULL); programme and course rows carry
 * the same columns nullable, where NULL means "inherit". These helpers
 * turn rows into the engine's Parameters / ParameterOverrides shapes; the
 * engine's step2ResolveParameters does the actual resolution and returns
 * the per-field provenance the report displays (FR-3).
 *
 * Band tables travel as JSON in the engine's own shape. They are cast
 * here and validated by the engine (validateParameters) the moment they
 * are resolved — a malformed table is a thrown error, never a number.
 */

interface InstitutionParameterRow {
  thresholdFraction: Prisma.Decimal;
  bands: Prisma.JsonValue;
  cohortBands: Prisma.JsonValue;
  weightGroups: Prisma.JsonValue;
  directWeight: Prisma.Decimal;
  indirectWeight: Prisma.Decimal;
  targetAttainment: Prisma.Decimal;
  feedbackResponseFloor: number;
}

interface OverrideParameterRow {
  thresholdFraction: Prisma.Decimal | null;
  bands: Prisma.JsonValue | null;
  cohortBands: Prisma.JsonValue | null;
  weightGroups: Prisma.JsonValue | null;
  directWeight: Prisma.Decimal | null;
  indirectWeight: Prisma.Decimal | null;
  targetAttainment: Prisma.Decimal | null;
  feedbackResponseFloor: number | null;
}

export function institutionParameters(row: InstitutionParameterRow): Parameters {
  return {
    thresholdFraction: row.thresholdFraction.toNumber(),
    bands: row.bands as unknown as BandRow[],
    cohortBands: row.cohortBands as unknown as CohortBandRow[],
    weightGroups: row.weightGroups as unknown as Record<string, number>,
    directWeight: row.directWeight.toNumber(),
    indirectWeight: row.indirectWeight.toNumber(),
    targetAttainment: row.targetAttainment.toNumber(),
    feedbackResponseFloor: row.feedbackResponseFloor,
  };
}

/** Only the fields a level actually overrides — NULL columns are omitted. */
export function parameterOverrides(row: OverrideParameterRow): ParameterOverrides {
  const overrides: ParameterOverrides = {};
  if (row.thresholdFraction !== null) overrides.thresholdFraction = row.thresholdFraction.toNumber();
  if (row.bands !== null) overrides.bands = row.bands as unknown as BandRow[];
  if (row.cohortBands !== null) overrides.cohortBands = row.cohortBands as unknown as CohortBandRow[];
  if (row.weightGroups !== null) overrides.weightGroups = row.weightGroups as unknown as Record<string, number>;
  if (row.directWeight !== null) overrides.directWeight = row.directWeight.toNumber();
  if (row.indirectWeight !== null) overrides.indirectWeight = row.indirectWeight.toNumber();
  if (row.targetAttainment !== null) overrides.targetAttainment = row.targetAttainment.toNumber();
  if (row.feedbackResponseFloor !== null) overrides.feedbackResponseFloor = row.feedbackResponseFloor;
  return overrides;
}
