import type { CourseInput } from '../../src/index';
import { makeCo, makeParams } from './helpers';

/**
 * The worked end-to-end course (NFR-7): two sectioned internal tests, an
 * assignment, a quiz, a seminar and an end-semester assessment. Five
 * students S1..S5, three COs, two POs. Default parameters throughout.
 *
 * EVERY expected value below is worked out by hand from the marks; the
 * engine's output is asserted against this derivation, never the other way
 * round. Threshold: mark ≥ 0.70 × max. Bands: ≥80→3, ≥60→2, ≥40→1, else 0.
 *
 * ── Step 1 — weightages ────────────────────────────────────────────────
 * matrix  co1:{po1:3, po2:1}  co2:{po1:2, po2:null}  co3:{po1:3, po2:2}
 * po1 = (3+2+3)/3 = 8/3 = 2.666…   po2 = (1+2)/2 = 1.5
 *
 * ── cia1 (SECTIONED, internal) ─────────────────────────────────────────
 * secA: q1(max2,co1)  q2(max2,co2)     secB: q3(max5,co1)  q4(max5,co2)
 *        S1  S2  S3   S4  S5           threshold
 * q1      2   2   2    1  null         1.4 → att4 clr3(2,2,2)   75%  → 2
 * q2      2   2   2    2   0           1.4 → att5 clr4          80%  → 3  ← exact-80 boundary; the 0 attempted
 * q3      5   4  3.5   3   2           3.5 → att5 clr3(5,4,3.5) 60%  → 2  ← exact-60; 3.5 exactly on threshold
 * q4      5   4   3    2  null         3.5 → att4 clr2(5,4)     50%  → 1
 * co1: secA(q1)=2, secB(q3)=2 → mean(2,2)=2
 * co2: secA(q2)=3, secB(q4)=1 → mean(3,1)=2
 *
 * ── cia2 (SECTIONED, internal) ─────────────────────────────────────────
 * secA: q1(max2,co2)  q2(max2,co3)     secB: q3(max10,co3)
 *        S1  S2  S3  S4  S5            threshold
 * q1      2   2   1   1   1            1.4 → att5 clr2          40%  → 1  ← exact-40 boundary
 * q2      2   2   2   1  null          1.4 → att4 clr3          75%  → 2
 * q3     10   9   8   7   6            7   → att5 clr4(10,9,8,7) 80% → 3  ← 7 exactly on threshold
 * co2: appears in secA only (q1) → 1   ← averaged over the sections in which it appears, not all sections
 * co3: secA(q2)=2, secB(q3)=3 → mean(2,3)=2.5
 *
 * ── assign (ITEM_LIST, continuous, UNTAGGED → every CO; info warning) ──
 * a1(max5): S1 5, S2 4, S3 4, S4 3.5, S5 3 → att5 clr4(5,4,4,3.5) 80% → 3
 *
 * ── quiz (ITEM_LIST, continuous) ───────────────────────────────────────
 * z1(max1,co1): S1 1, S2 1, S3 1, S4 0, S5 null → att4 clr3  75%  → 2
 * z2(max1,co2): S1 1, S2 1, rest null           → att2 clr2  100% → 3
 *
 * ── seminar (SINGLE_SCORE, RUBRIC, continuous, coTags [co3], max 10) ───
 * S1 9, S2 8, S3 7, S4 7, S5 5 → threshold 7 → att5 clr4(9,8,7,7) 80% → 3
 *
 * ── endsem (SINGLE_SCORE, COHORT_BAND, external, max 75, UNTAGGED) ─────
 * S1 60, S2 45, S3 44, S4 40, S5 30 → att5
 * L3: ≥60% (45 of 75): 60,45      → 2/5 = 40% of students < 50 → fail
 * L2: ≥53.3% (39.975): 60,45,44,40 → 4/5 = 80% ≥ 50            → level 2
 *
 * ── Step 5 — group levels ──────────────────────────────────────────────
 * internal:   co1 = 2 (cia1 only)   co2 = mean(2,1) = 1.5   co3 = 2.5 (cia2 only)
 * continuous: co1 = mean(assign 3, quiz 2)   = 2.5
 *             co2 = mean(assign 3, quiz 3)   = 3
 *             co3 = mean(assign 3, seminar 3) = 3
 * external:   co1 = co2 = co3 = 2
 *
 * ── Step 8 — indirect ──────────────────────────────────────────────────
 * co1 (1,1,8): (1+2+24)/10 = 2.7   co2 (0,5,5): (10+15)/10 = 2.5
 * co3 (2,3,5): (2+6+15)/10 = 2.3
 *
 * ── Step 9 — direct and final (0.2/0.1/0.7, then 0.9/0.1) ─────────────
 * co1: direct = .2(2)  +.1(2.5)+.7(2) = 2.05  final = .9(2.05)+.1(2.7) = 2.115
 * co2: direct = .2(1.5)+.1(3)  +.7(2) = 2.00  final = .9(2.00)+.1(2.5) = 2.05
 * co3: direct = .2(2.5)+.1(3)  +.7(2) = 2.20  final = .9(2.20)+.1(2.3) = 2.21
 * All three below the 2.5 target → flagged.
 *
 * ── Step 10 — PO projection ────────────────────────────────────────────
 * mean final = (2.115+2.05+2.21)/3 = 6.375/3 = 2.125
 * po1 official  = (8/3)(2.125)/3 = 17/9 = 1.888…
 * po1 secondary = (3(2.115)+2(2.05)+3(2.21))/(3+2+3) = 17.075/8 = 2.134375
 * po2 official  = 1.5(2.125)/3 = 1.0625
 * po2 secondary = (1(2.115)+2(2.21))/(1+2) = 6.535/3 = 2.178333…  (co2 maps to po2 as null → excluded from both sums)
 *
 * Expected warnings: exactly two ASSESSMENT_UNTAGGED (assign, endsem), both info.
 */
export function buildE2ECourse(): CourseInput {
  return {
    cos: [makeCo('co1'), makeCo('co2'), makeCo('co3')],
    poMatrix: {
      co1: { po1: 3, po2: 1 },
      co2: { po1: 2, po2: null },
      co3: { po1: 3, po2: 2 },
    },
    parameters: makeParams(),
    assessments: [
      {
        id: 'cia1',
        name: 'Internal Test I',
        shape: 'SECTIONED',
        scoringRule: 'RUBRIC',
        weightGroup: 'internal',
        sections: [
          {
            id: 'secA',
            name: 'Section A',
            items: [
              { id: 'q1', maxMark: 2, coTag: 'co1' },
              { id: 'q2', maxMark: 2, coTag: 'co2' },
            ],
          },
          {
            id: 'secB',
            name: 'Section B',
            items: [
              { id: 'q3', maxMark: 5, coTag: 'co1' },
              { id: 'q4', maxMark: 5, coTag: 'co2' },
            ],
          },
        ],
        marks: {
          S1: { q1: 2, q2: 2, q3: 5, q4: 5 },
          S2: { q1: 2, q2: 2, q3: 4, q4: 4 },
          S3: { q1: 2, q2: 2, q3: 3.5, q4: 3 },
          S4: { q1: 1, q2: 2, q3: 3, q4: 2 },
          S5: { q1: null, q2: 0, q3: 2, q4: null },
        },
      },
      {
        id: 'cia2',
        name: 'Internal Test II',
        shape: 'SECTIONED',
        scoringRule: 'RUBRIC',
        weightGroup: 'internal',
        sections: [
          {
            id: 'secA',
            name: 'Section A',
            items: [
              { id: 'q1', maxMark: 2, coTag: 'co2' },
              { id: 'q2', maxMark: 2, coTag: 'co3' },
            ],
          },
          {
            id: 'secB',
            name: 'Section B',
            items: [{ id: 'q3', maxMark: 10, coTag: 'co3' }],
          },
        ],
        marks: {
          S1: { q1: 2, q2: 2, q3: 10 },
          S2: { q1: 2, q2: 2, q3: 9 },
          S3: { q1: 1, q2: 2, q3: 8 },
          S4: { q1: 1, q2: 1, q3: 7 },
          S5: { q1: 1, q2: null, q3: 6 },
        },
      },
      {
        id: 'assign',
        name: 'Assignment',
        shape: 'ITEM_LIST',
        scoringRule: 'RUBRIC',
        weightGroup: 'continuous',
        items: [{ id: 'a1', maxMark: 5, coTag: null }],
        marks: {
          S1: { a1: 5 },
          S2: { a1: 4 },
          S3: { a1: 4 },
          S4: { a1: 3.5 },
          S5: { a1: 3 },
        },
      },
      {
        id: 'quiz',
        name: 'Quiz',
        shape: 'ITEM_LIST',
        scoringRule: 'RUBRIC',
        weightGroup: 'continuous',
        items: [
          { id: 'z1', maxMark: 1, coTag: 'co1' },
          { id: 'z2', maxMark: 1, coTag: 'co2' },
        ],
        marks: {
          S1: { z1: 1, z2: 1 },
          S2: { z1: 1, z2: 1 },
          S3: { z1: 1, z2: null },
          S4: { z1: 0, z2: null },
          S5: { z1: null, z2: null },
        },
      },
      {
        id: 'seminar',
        name: 'Seminar',
        shape: 'SINGLE_SCORE',
        scoringRule: 'RUBRIC',
        weightGroup: 'continuous',
        maxMark: 10,
        coTags: ['co3'],
        marks: {
          S1: { seminar: 9 },
          S2: { seminar: 8 },
          S3: { seminar: 7 },
          S4: { seminar: 7 },
          S5: { seminar: 5 },
        },
      },
      {
        id: 'endsem',
        name: 'End-Semester Examination',
        shape: 'SINGLE_SCORE',
        scoringRule: 'COHORT_BAND',
        weightGroup: 'external',
        maxMark: 75,
        marks: {
          S1: { endsem: 60 },
          S2: { endsem: 45 },
          S3: { endsem: 44 },
          S4: { endsem: 40 },
          S5: { endsem: 30 },
        },
      },
    ],
    indirect: {
      co1: { n1: 1, n2: 1, n3: 8 },
      co2: { n1: 0, n2: 5, n3: 5 },
      co3: { n1: 2, n2: 3, n3: 5 },
    },
  };
}
