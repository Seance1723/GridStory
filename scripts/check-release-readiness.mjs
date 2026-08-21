import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';

const stageOrder = ['alpha', 'beta', 'rc', 'ga'];
const criterionPrefixes = { alpha: 'ALPHA', beta: 'BETA', rc: 'RC', ga: 'GA' };
const outcomes = new Set(['go', 'no-go']);
const statuses = new Set(['met', 'unmet', 'not-applicable']);
const evidenceKinds = new Set(['repository', 'executed', 'external']);

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

function exactKeys(value, keys, path) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${path} must contain exactly: ${expected.join(', ')}.`);
  }
}

function string(value, path, minimum = 1) {
  if (typeof value !== 'string' || value.trim().length < minimum) {
    throw new Error(`${path} must be a non-empty string.`);
  }
}

function repositoryEvidencePath(location, path) {
  string(location, `${path}.location`);
  const resolved = resolve(process.cwd(), location);
  const repositoryRelative = relative(process.cwd(), resolved);
  if (
    !repositoryRelative ||
    repositoryRelative.startsWith('..') ||
    repositoryRelative.split(sep).includes('..')
  ) {
    throw new Error(`${path}.location must stay inside the repository.`);
  }
  if (!existsSync(resolved)) throw new Error(`${path}.location does not exist: ${location}.`);
}

export function validateReadinessReview(input) {
  const review = object(input, 'review');
  exactKeys(
    review,
    [
      'schemaVersion',
      'reviewId',
      'reviewedAt',
      'reviewedCommit',
      'candidate',
      'reviewer',
      'stages',
      'claimBoundary',
    ],
    'review',
  );
  if (review.schemaVersion !== 1) throw new Error('review.schemaVersion must be 1.');
  string(review.reviewId, 'review.reviewId');
  if (
    typeof review.reviewedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/u.test(review.reviewedAt) ||
    Number.isNaN(Date.parse(review.reviewedAt))
  ) {
    throw new Error('review.reviewedAt must be an ISO-8601 timestamp with an offset.');
  }
  if (typeof review.reviewedCommit !== 'string' || !/^[a-f0-9]{40}$/u.test(review.reviewedCommit)) {
    throw new Error('review.reviewedCommit must be a full lowercase Git SHA-1.');
  }
  string(review.claimBoundary, 'review.claimBoundary', 80);

  const candidate = object(review.candidate, 'review.candidate');
  exactKeys(candidate, ['version', 'distribution', 'deployment'], 'review.candidate');
  string(candidate.version, 'review.candidate.version');
  string(candidate.distribution, 'review.candidate.distribution');
  string(candidate.deployment, 'review.candidate.deployment');

  const reviewer = object(review.reviewer, 'review.reviewer');
  exactKeys(reviewer, ['name', 'role', 'independence'], 'review.reviewer');
  string(reviewer.name, 'review.reviewer.name');
  string(reviewer.role, 'review.reviewer.role');
  string(reviewer.independence, 'review.reviewer.independence');

  if (!Array.isArray(review.stages) || review.stages.length !== stageOrder.length) {
    throw new Error(`review.stages must contain exactly ${stageOrder.length} stages.`);
  }
  const criterionIds = new Set();
  let previousOutcome;
  for (const [stageIndex, expectedStageId] of stageOrder.entries()) {
    const stagePath = `review.stages[${stageIndex}]`;
    const stage = object(review.stages[stageIndex], stagePath);
    exactKeys(stage, ['id', 'label', 'outcome', 'summary', 'criteria'], stagePath);
    if (stage.id !== expectedStageId) {
      throw new Error(`${stagePath}.id must be ${expectedStageId}; stages cannot be reordered.`);
    }
    string(stage.label, `${stagePath}.label`);
    string(stage.summary, `${stagePath}.summary`, 40);
    if (!outcomes.has(stage.outcome)) throw new Error(`${stagePath}.outcome is unsupported.`);
    if (!Array.isArray(stage.criteria) || stage.criteria.length === 0) {
      throw new Error(`${stagePath}.criteria must contain at least one criterion.`);
    }

    let hasRequiredGap = false;
    for (const [criterionIndex, rawCriterion] of stage.criteria.entries()) {
      const criterionPath = `${stagePath}.criteria[${criterionIndex}]`;
      const criterion = object(rawCriterion, criterionPath);
      exactKeys(
        criterion,
        ['id', 'required', 'status', 'statement', 'owner', 'nextAction', 'evidence'],
        criterionPath,
      );
      if (
        typeof criterion.id !== 'string' ||
        !new RegExp(`^${criterionPrefixes[expectedStageId]}-[0-9]{3}$`, 'u').test(criterion.id)
      ) {
        throw new Error(
          `${criterionPath}.id must use the ${criterionPrefixes[expectedStageId]}-NNN form.`,
        );
      }
      if (criterionIds.has(criterion.id))
        throw new Error(`Duplicate criterion id ${criterion.id}.`);
      criterionIds.add(criterion.id);
      if (typeof criterion.required !== 'boolean') {
        throw new Error(`${criterionPath}.required must be boolean.`);
      }
      if (!statuses.has(criterion.status))
        throw new Error(`${criterionPath}.status is unsupported.`);
      if (criterion.required && criterion.status === 'not-applicable') {
        throw new Error(`${criterionPath} is required and cannot be not-applicable.`);
      }
      string(criterion.statement, `${criterionPath}.statement`, 20);
      string(criterion.owner, `${criterionPath}.owner`);
      string(criterion.nextAction, `${criterionPath}.nextAction`, 15);
      if (!Array.isArray(criterion.evidence) || criterion.evidence.length === 0) {
        throw new Error(`${criterionPath}.evidence must contain at least one record.`);
      }

      let hasVerifiableEvidence = false;
      for (const [evidenceIndex, rawEvidence] of criterion.evidence.entries()) {
        const evidencePath = `${criterionPath}.evidence[${evidenceIndex}]`;
        const evidence = object(rawEvidence, evidencePath);
        exactKeys(evidence, ['kind', 'location', 'note'], evidencePath);
        if (!evidenceKinds.has(evidence.kind)) {
          throw new Error(`${evidencePath}.kind is unsupported.`);
        }
        string(evidence.location, `${evidencePath}.location`);
        string(evidence.note, `${evidencePath}.note`, 15);
        if (evidence.kind === 'repository') repositoryEvidencePath(evidence.location, evidencePath);
        if (evidence.kind === 'repository' || evidence.kind === 'executed') {
          hasVerifiableEvidence = true;
        }
      }
      if (criterion.status === 'met' && !hasVerifiableEvidence) {
        throw new Error(`${criterionPath} cannot be met from external evidence alone.`);
      }
      if (criterion.required && criterion.status !== 'met') hasRequiredGap = true;
    }

    const expectedOutcome = hasRequiredGap || previousOutcome === 'no-go' ? 'no-go' : 'go';
    if (stage.outcome !== expectedOutcome) {
      throw new Error(
        `${stagePath}.outcome must be ${expectedOutcome} from its required criteria and predecessor.`,
      );
    }
    previousOutcome = stage.outcome;
  }

  return review;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectRejected(review, label, mutate) {
  const changed = clone(review);
  mutate(changed);
  try {
    validateReadinessReview(changed);
  } catch {
    return;
  }
  throw new Error(`Negative readiness self-test did not reject ${label}.`);
}

function runSelfTests(review) {
  expectRejected(review, 'a missing stage', (value) => value.stages.pop());
  expectRejected(review, 'reordered stages', (value) => value.stages.reverse());
  expectRejected(review, 'an unsupported candidate commit', (value) => {
    value.reviewedCommit = 'b31193a';
  });
  expectRejected(review, 'a duplicate criterion id', (value) => {
    value.stages[0].criteria[1].id = value.stages[0].criteria[0].id;
  });
  expectRejected(review, 'repository path traversal', (value) => {
    value.stages[0].criteria[0].evidence[0].location = '../outside';
  });
  expectRejected(review, 'external-only proof marked met', (value) => {
    value.stages[1].criteria[1].status = 'met';
  });
  expectRejected(review, 'a beta go over an unmet gate', (value) => {
    value.stages[1].outcome = 'go';
  });
  expectRejected(review, 'an RC go over a beta no-go', (value) => {
    value.stages[2].outcome = 'go';
  });
  expectRejected(review, 'a required criterion marked not applicable', (value) => {
    value.stages[3].criteria[0].status = 'not-applicable';
  });
  console.log('Readiness review negative self-tests passed.');
}

const reviewPath = resolve(
  argument('--review', 'release/readiness/review-2026-08-21-b31193a.json'),
);
const review = validateReadinessReview(JSON.parse(readFileSync(reviewPath, 'utf8')));
if (process.argv.includes('--self-test')) runSelfTests(review);
console.log(
  `Readiness review ${review.reviewId} is valid: ${review.stages.map(({ id, outcome }) => `${id}=${outcome}`).join(', ')}.`,
);
