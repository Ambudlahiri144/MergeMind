import type { Severity } from '@mergemind/shared';

import { matchFixture, type ExpectedLocated, type ReportedFinding } from './match.js';

/** PRD §7 gates. */
export const PRECISION_TARGET = 0.7;
export const RECALL_TARGET = 0.5;

const BLOCKING: ReadonlySet<Severity> = new Set(['critical', 'major']);

export type FixtureOutcome = {
  id: string;
  /** The seeded bug's category, or `clean` for a fixture without bugs. */
  category: string;
  reported: ReportedFinding[];
  expected: ExpectedLocated[];
  /** Every provider failed for at least one pass: the fixture is excluded from the scores. */
  isFailed: boolean;
};

export type FixtureScore = {
  id: string;
  category: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  minorNoise: number;
  /** Seeded critical/major bugs, and how many of them any report matched (recall). */
  blockingBugs: number;
  blockingBugsFound: number;
  isFailed: boolean;
};

/**
 * Per fixture: a reported critical/major that matches a seeded bug is a true positive, one
 * that matches nothing is a false positive; a critical/major seeded bug nobody matched is a
 * false negative. Unmatched minor reports are counted as noise, not gated (ADR-032).
 */
export function scoreFixture(outcome: FixtureOutcome): FixtureScore {
  const match = matchFixture(outcome.reported, outcome.expected);
  const matchedReported = new Set(match.pairs.map((pair) => pair.reported));
  let truePositives = 0;
  let falsePositives = 0;
  let minorNoise = 0;
  outcome.reported.forEach((finding, index) => {
    const isBlocking = BLOCKING.has(finding.severity);
    if (matchedReported.has(index)) {
      truePositives += isBlocking ? 1 : 0;
    } else if (isBlocking) {
      falsePositives += 1;
    } else {
      minorNoise += 1;
    }
  });
  const falseNegatives = match.unmatchedExpected.filter((index) => {
    const bug = outcome.expected[index];
    return bug !== undefined && BLOCKING.has(bug.severity);
  }).length;
  const blockingBugs = outcome.expected.filter((bug) => BLOCKING.has(bug.severity)).length;
  return {
    id: outcome.id,
    category: outcome.category,
    truePositives,
    falsePositives,
    falseNegatives,
    minorNoise,
    blockingBugs,
    blockingBugsFound: blockingBugs - falseNegatives,
    isFailed: outcome.isFailed,
  };
}

export type Gate = { value: number; target: number; isPassed: boolean };

export type BenchmarkSummary = {
  fixtures: number;
  failedFixtures: number;
  precision: Gate;
  /** Recall over seeded critical + major bugs (PRD §7). */
  recall: Gate;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  minorNoise: number;
  /** Reports of any severity on fixtures that have no bug. */
  cleanFixtureReports: number;
  byCategory: Record<string, { expected: number; found: number }>;
  isPassed: boolean;
};

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function summarize(outcomes: readonly FixtureOutcome[]): BenchmarkSummary {
  const scored = outcomes.filter((outcome) => !outcome.isFailed);
  const scores = scored.map(scoreFixture);
  const sum = (
    key:
      | 'truePositives'
      | 'falsePositives'
      | 'falseNegatives'
      | 'minorNoise'
      | 'blockingBugs'
      | 'blockingBugsFound',
  ) => scores.reduce((total, score) => total + score[key], 0);
  const truePositives = sum('truePositives');
  const falsePositives = sum('falsePositives');
  const falseNegatives = sum('falseNegatives');

  const byCategory: BenchmarkSummary['byCategory'] = {};
  for (const outcome of scored) {
    const match = matchFixture(outcome.reported, outcome.expected);
    for (const [index, bug] of outcome.expected.entries()) {
      const entry = (byCategory[bug.category] ??= { expected: 0, found: 0 });
      entry.expected += 1;
      entry.found += match.pairs.some((pair) => pair.expected === index) ? 1 : 0;
    }
  }

  const precisionValue = ratio(truePositives, truePositives + falsePositives);
  // Not TP / (TP + FN): a seeded major bug reported only as minor is still found, and a
  // seeded minor bug matched by a major report is not part of the denominator.
  const recallValue = ratio(sum('blockingBugsFound'), sum('blockingBugs'));
  const precision = {
    value: precisionValue,
    target: PRECISION_TARGET,
    isPassed: precisionValue >= PRECISION_TARGET,
  };
  const recall = {
    value: recallValue,
    target: RECALL_TARGET,
    isPassed: recallValue >= RECALL_TARGET,
  };
  return {
    fixtures: outcomes.length,
    failedFixtures: outcomes.length - scored.length,
    precision,
    recall,
    truePositives,
    falsePositives,
    falseNegatives,
    minorNoise: sum('minorNoise'),
    cleanFixtureReports: scored
      .filter((outcome) => outcome.expected.length === 0)
      .reduce((total, outcome) => total + outcome.reported.length, 0),
    byCategory,
    // Failed fixtures mean the numbers are partial: never call that a pass.
    isPassed: precision.isPassed && recall.isPassed && scored.length === outcomes.length,
  };
}
