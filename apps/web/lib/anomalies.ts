import 'server-only';
import { Prisma } from '@copo/db';
import { prisma } from './db';
import { resolveCourseParameters } from './params';
import {
  feedbackBelowFloor,
  overAttemptedSections,
  unassessedCoIds,
  type AssessmentCoverage,
  type FeedbackStatus,
  type SectionAttempt,
} from './anomalyLogic';

/**
 * The pre-calculation anomaly report (FR-13). Faculty see this BEFORE they
 * compute. Every count is aggregated in SQL over the MarkValue indexes —
 * no query loads the course's marks into memory (NFR-1). The pure
 * classifiers (anomalyLogic.ts) turn the aggregates into findings.
 */

export interface MarkOverMax {
  registerNumber: string;
  studentName: string;
  itemLabel: string;
  assessmentName: string;
  value: number;
  maxMark: number;
}
export interface NoMarksStudent {
  assessmentName: string;
  registerNumber: string;
  studentName: string;
}
export interface UnattemptedItem {
  assessmentName: string;
  itemLabel: string;
}
export interface AnomalyReport {
  enrolmentCount: number;
  assessmentCount: number;
  marksOverMax: MarkOverMax[];
  overAttempts: SectionAttempt[];
  studentsWithNoMarks: NoMarksStudent[];
  unattemptedItems: UnattemptedItem[];
  unassessedCos: { code: string; statement: string }[];
  feedbackShort: (FeedbackStatus & { note: string })[];
  /** True when nothing was flagged. */
  clean: boolean;
}

export async function computeAnomalies(courseId: string): Promise<AnomalyReport> {
  const [course, enrolments, assessments, cos, feedbackParams] = await Promise.all([
    prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { id: true } }),
    prisma.enrolment.findMany({
      where: { courseId },
      select: { id: true, rosterEntry: { select: { registerNumber: true, student: { select: { fullName: true } } } } },
    }),
    prisma.assessment.findMany({
      where: { courseId },
      select: {
        id: true,
        name: true,
        coTags: { select: { coId: true } },
        sections: { select: { id: true, name: true, optionalAnswerCount: true, items: { select: { id: true } } } },
        items: { select: { id: true, label: true, coId: true, maxMark: true, sectionId: true } },
      },
    }),
    prisma.courseOutcome.findMany({ where: { courseId }, orderBy: { displayOrder: 'asc' }, select: { id: true, code: true, statement: true } }),
    resolveCourseParameters(courseId),
  ]);
  void course;

  const studentByEnrolment = new Map(
    enrolments.map((e) => [e.id, { registerNumber: e.rosterEntry.registerNumber, studentName: e.rosterEntry.student.fullName }]),
  );
  const assessmentName = new Map(assessments.map((a) => [a.id, a.name]));
  const itemMeta = new Map(
    assessments.flatMap((a) => a.items.map((item) => [item.id, { label: item.label, assessmentName: a.name, maxMark: item.maxMark.toNumber() }])),
  );

  // 1 ── marks over the item maximum (defensive; entry validates, but an
  //      import or a lowered maximum could leave one behind).
  const overMaxRows = await prisma.$queryRaw<{ enrolmentId: string; itemId: string; value: Prisma.Decimal }[]>`
    SELECT mv."enrolmentId", mv."itemId", mv."value"
    FROM "MarkValue" mv
    JOIN "Item" i ON i."id" = mv."itemId"
    WHERE mv."courseId" = ${courseId} AND mv."value" IS NOT NULL AND mv."value" > i."maxMark"`;
  const marksOverMax: MarkOverMax[] = overMaxRows.map((row) => {
    const student = studentByEnrolment.get(row.enrolmentId);
    const item = itemMeta.get(row.itemId);
    return {
      registerNumber: student?.registerNumber ?? row.enrolmentId,
      studentName: student?.studentName ?? '',
      itemLabel: item?.label ?? row.itemId,
      assessmentName: item?.assessmentName ?? '',
      value: row.value.toNumber(),
      maxMark: item?.maxMark ?? 0,
    };
  });

  // 2 ── students who attempted more of a section's optional questions than
  //      permitted. Attempt counts per (enrolment, section) from SQL.
  const sectionsWithRule = assessments.flatMap((a) =>
    a.sections
      .filter((section) => section.optionalAnswerCount !== null && section.items.length > 0)
      .map((section) => ({ assessmentName: a.name, sectionId: section.id, sectionName: section.name, permitted: section.optionalAnswerCount!, itemIds: section.items.map((item) => item.id) })),
  );
  const overAttempts: SectionAttempt[] = [];
  if (sectionsWithRule.length > 0) {
    const allItemIds = sectionsWithRule.flatMap((section) => section.itemIds);
    const counts = await prisma.markValue.groupBy({
      by: ['enrolmentId', 'itemId'],
      where: { courseId, itemId: { in: allItemIds }, value: { not: null } },
      _count: { _all: true },
    });
    // itemId → sectionRule
    const ruleByItem = new Map(sectionsWithRule.flatMap((section) => section.itemIds.map((itemId) => [itemId, section])));
    // (enrolment, section) → attempted count
    const attemptCount = new Map<string, number>();
    for (const row of counts) {
      const rule = ruleByItem.get(row.itemId);
      if (!rule) continue;
      const key = `${row.enrolmentId}:${rule.sectionId}`;
      attemptCount.set(key, (attemptCount.get(key) ?? 0) + 1);
    }
    const attempts: SectionAttempt[] = [];
    for (const [key, attempted] of attemptCount) {
      const [enrolmentId, sectionId] = key.split(':') as [string, string];
      const rule = sectionsWithRule.find((section) => section.sectionId === sectionId)!;
      const student = studentByEnrolment.get(enrolmentId);
      attempts.push({
        enrolmentId,
        registerNumber: student?.registerNumber ?? enrolmentId,
        studentName: student?.studentName ?? '',
        sectionId,
        sectionName: rule.sectionName,
        assessmentName: rule.assessmentName,
        attempted,
        permitted: rule.permitted,
      });
    }
    overAttempts.push(...overAttemptedSections(attempts));
  }

  // 3 & 4 ── per assessment: students with no marks, and items nobody
  //          attempted. One grouped query per assessment (few per course).
  const studentsWithNoMarks: NoMarksStudent[] = [];
  const unattemptedItems: UnattemptedItem[] = [];
  for (const assessment of assessments) {
    const attemptedByEnrolment = await prisma.markValue.groupBy({
      by: ['enrolmentId'],
      where: { assessmentId: assessment.id, value: { not: null } },
      _count: { _all: true },
    });
    const attemptedEnrolments = new Set(attemptedByEnrolment.map((row) => row.enrolmentId));
    for (const enrolment of enrolments) {
      if (!attemptedEnrolments.has(enrolment.id)) {
        studentsWithNoMarks.push({
          assessmentName: assessment.name,
          registerNumber: enrolment.rosterEntry.registerNumber,
          studentName: enrolment.rosterEntry.student.fullName,
        });
      }
    }
    const attemptedByItem = await prisma.markValue.groupBy({
      by: ['itemId'],
      where: { assessmentId: assessment.id, value: { not: null } },
      _count: { _all: true },
    });
    const attemptedItems = new Set(attemptedByItem.map((row) => row.itemId));
    for (const item of assessment.items) {
      if (!attemptedItems.has(item.id)) unattemptedItems.push({ assessmentName: assessment.name, itemLabel: item.label });
    }
  }

  // 5 ── COs assessed nowhere (structural; matches the engine's coverage).
  const coverage: AssessmentCoverage[] = assessments.map((a) => {
    const isSingleScore = a.sections.length === 0 && a.items.length === 1;
    const untaggedItem = a.items.some((item) => item.coId === null);
    const coversAllCos = isSingleScore ? a.coTags.length === 0 : untaggedItem;
    const taggedCoIds = [
      ...a.items.map((item) => item.coId).filter((coId): coId is string => coId !== null),
      ...a.coTags.map((tag) => tag.coId),
    ];
    return { assessmentId: a.id, name: a.name, coversAllCos, taggedCoIds };
  });
  const unassessed = new Set(unassessedCoIds(cos.map((co) => co.id), coverage));
  const unassessedCos = cos.filter((co) => unassessed.has(co.id)).map((co) => ({ code: co.code, statement: co.statement }));

  // 6 ── indirect feedback below the configured floor.
  const floor = feedbackParams.parameters.feedbackResponseFloor;
  const feedbackRows = await prisma.indirectFeedback.findMany({ where: { coId: { in: cos.map((co) => co.id) } } });
  const responsesByCo = new Map(feedbackRows.map((row) => [row.coId, row.n1 + row.n2 + row.n3]));
  const feedbackStatuses: FeedbackStatus[] = cos.map((co) => ({
    coId: co.id,
    coCode: co.code,
    responses: responsesByCo.get(co.id) ?? 0,
    floor,
  }));
  const feedbackShort = feedbackBelowFloor(feedbackStatuses).map((status) => ({
    ...status,
    note: status.responses === 0 ? 'no feedback collected' : `${status.responses} of ${status.floor} required`,
  }));

  const clean =
    marksOverMax.length === 0 &&
    overAttempts.length === 0 &&
    studentsWithNoMarks.length === 0 &&
    unattemptedItems.length === 0 &&
    unassessedCos.length === 0 &&
    feedbackShort.length === 0;

  return {
    enrolmentCount: enrolments.length,
    assessmentCount: assessments.length,
    marksOverMax,
    overAttempts,
    studentsWithNoMarks,
    unattemptedItems,
    unassessedCos,
    feedbackShort,
    clean,
  };
}
