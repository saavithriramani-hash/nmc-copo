import { describe, expect, it } from 'vitest';
import { feedbackBelowFloor, overAttemptedSections, unassessedCoIds } from '../lib/anomalyLogic';
import type { AssessmentCoverage, FeedbackStatus, SectionAttempt } from '../lib/anomalyLogic';

describe('unassessedCoIds', () => {
  const cos = ['co1', 'co2', 'co3'];

  it('flags COs no assessment tags', () => {
    const assessments: AssessmentCoverage[] = [
      { assessmentId: 'a1', name: 'CIA', coversAllCos: false, taggedCoIds: ['co1', 'co2'] },
    ];
    expect(unassessedCoIds(cos, assessments)).toEqual(['co3']);
  });

  it('an assessment that covers all COs (untagged assignment / end-sem) clears everything', () => {
    const assessments: AssessmentCoverage[] = [
      { assessmentId: 'a1', name: 'CIA', coversAllCos: false, taggedCoIds: ['co1'] },
      { assessmentId: 'end', name: 'End-Sem', coversAllCos: true, taggedCoIds: [] },
    ];
    expect(unassessedCoIds(cos, assessments)).toEqual([]);
  });

  it('with no assessments, every CO is unassessed', () => {
    expect(unassessedCoIds(cos, [])).toEqual(['co1', 'co2', 'co3']);
  });
});

describe('overAttemptedSections', () => {
  it('flags only students who attempted more than the section permits', () => {
    const base = { registerNumber: 'r', studentName: 's', sectionId: 'sec', sectionName: 'B', assessmentName: 'CIA' };
    const attempts: SectionAttempt[] = [
      { ...base, enrolmentId: 'e1', attempted: 5, permitted: 5 }, // exactly permitted — fine
      { ...base, enrolmentId: 'e2', attempted: 6, permitted: 5 }, // over
      { ...base, enrolmentId: 'e3', attempted: 3, permitted: 5 }, // under — fine
    ];
    expect(overAttemptedSections(attempts).map((attempt) => attempt.enrolmentId)).toEqual(['e2']);
  });
});

describe('feedbackBelowFloor', () => {
  it('flags COs below a set floor, including zero responses; a floor of 0 disables the check', () => {
    const statuses: FeedbackStatus[] = [
      { coId: 'co1', coCode: 'CO1', responses: 30, floor: 10 }, // ok
      { coId: 'co2', coCode: 'CO2', responses: 4, floor: 10 }, // below
      { coId: 'co3', coCode: 'CO3', responses: 0, floor: 10 }, // none
    ];
    expect(feedbackBelowFloor(statuses).map((status) => status.coId)).toEqual(['co2', 'co3']);

    const disabled: FeedbackStatus[] = [{ coId: 'co1', coCode: 'CO1', responses: 0, floor: 0 }];
    expect(feedbackBelowFloor(disabled)).toEqual([]);
  });
});
