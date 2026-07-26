import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const threatPath = resolve(root, 'security/threat-model.json');
const profilePath = resolve(root, 'security/asvs-v5.0.0-profile.json');

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse ${path}: ${error instanceof Error ? error.message : error}`);
  }
}

function duplicateIds(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function nonEmptyStrings(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

function validate(threatDocument, profileDocument) {
  const errors = [];
  const fail = (message) => errors.push(message);
  const threatModel = threatDocument?.model;
  const actors = threatDocument?.actors ?? [];
  const assets = threatDocument?.assets ?? [];
  const boundaries = threatDocument?.trustBoundaries ?? [];
  const flows = threatDocument?.dataFlows ?? [];
  const threats = threatDocument?.threats ?? [];
  const chapters = profileDocument?.chapters ?? [];
  const requirements = profileDocument?.requirements ?? [];

  if (threatDocument?.schemaVersion !== 1) fail('threat model schemaVersion must be 1');
  if (profileDocument?.schemaVersion !== 1) fail('ASVS profile schemaVersion must be 1');
  if (!/^GRIDSTORY-TM-\d{3}$/.test(threatModel?.id ?? '')) fail('threat model id is invalid');
  if (profileDocument?.profile?.standardVersion !== '5.0.0')
    fail('ASVS profile must pin standardVersion 5.0.0');
  if (!profileDocument?.profile?.statement?.includes('not an ASVS certification')) {
    fail('ASVS profile must explicitly disclaim certification');
  }

  const entityGroups = [
    ['actor', actors, /^ACTOR-\d{3}$/],
    ['asset', assets, /^ASSET-\d{3}$/],
    ['boundary', boundaries, /^BOUNDARY-\d{3}$/],
    ['flow', flows, /^FLOW-\d{3}$/],
    ['threat', threats, /^THREAT-\d{4}$/],
    ['requirement', requirements, /^GS-SEC-\d{3}$/],
  ];
  for (const [label, records, pattern] of entityGroups) {
    if (!Array.isArray(records) || records.length === 0) fail(`${label} records must be non-empty`);
    const ids = records.map((record) => record?.id);
    for (const id of ids) if (!pattern.test(id ?? '')) fail(`${label} id ${String(id)} is invalid`);
    const duplicates = duplicateIds(ids);
    if (duplicates.length > 0) fail(`duplicate ${label} ids: ${duplicates.join(', ')}`);
  }

  const actorIds = new Set(actors.map(({ id }) => id));
  const assetIds = new Set(assets.map(({ id }) => id));
  const boundaryIds = new Set(boundaries.map(({ id }) => id));
  const endpointIds = new Set([...actorIds, ...boundaryIds]);
  const threatIds = new Set(threats.map(({ id }) => id));

  for (const flow of flows) {
    if (!endpointIds.has(flow.from)) fail(`${flow.id} has unknown from reference ${flow.from}`);
    if (!endpointIds.has(flow.to)) fail(`${flow.id} has unknown to reference ${flow.to}`);
    if (!nonEmptyStrings(flow.assets)) fail(`${flow.id} must reference at least one asset`);
    for (const id of flow.assets ?? [])
      if (!assetIds.has(id)) fail(`${flow.id} has unknown asset ${id}`);
  }

  const allowedStride = new Set([
    'Spoofing',
    'Tampering',
    'Repudiation',
    'Information Disclosure',
    'Denial of Service',
    'Elevation of Privilege',
  ]);
  const seenStride = new Set();
  const allowedResponses = new Set(['mitigate', 'eliminate', 'transfer', 'accept']);
  for (const threat of threats) {
    if (!nonEmptyStrings(threat.stride)) fail(`${threat.id} must have STRIDE categories`);
    for (const category of threat.stride ?? []) {
      if (!allowedStride.has(category))
        fail(`${threat.id} has unknown STRIDE category ${category}`);
      seenStride.add(category);
    }
    if (!Number.isInteger(threat.likelihood) || threat.likelihood < 1 || threat.likelihood > 5) {
      fail(`${threat.id} likelihood must be an integer from 1 to 5`);
    }
    if (!Number.isInteger(threat.impact) || threat.impact < 1 || threat.impact > 5) {
      fail(`${threat.id} impact must be an integer from 1 to 5`);
    }
    if (threat.risk !== threat.likelihood * threat.impact)
      fail(`${threat.id} risk must equal likelihood * impact`);
    if (!allowedResponses.has(threat.response))
      fail(`${threat.id} response ${threat.response} is invalid`);
    if (typeof threat.owner !== 'string' || threat.owner.trim().length === 0)
      fail(`${threat.id} must have an owner`);
    if (!nonEmptyStrings(threat.mitigations)) fail(`${threat.id} must have mitigations`);
    if (!nonEmptyStrings(threat.verification))
      fail(`${threat.id} must have verification evidence or a task`);
    if (!nonEmptyStrings(threat.actors)) fail(`${threat.id} must reference actors`);
    for (const id of threat.actors ?? [])
      if (!actorIds.has(id)) fail(`${threat.id} has unknown actor ${id}`);
    if (!nonEmptyStrings(threat.assets)) fail(`${threat.id} must reference assets`);
    for (const id of threat.assets ?? [])
      if (!assetIds.has(id)) fail(`${threat.id} has unknown asset ${id}`);
    if (!nonEmptyStrings(threat.boundaries)) fail(`${threat.id} must reference boundaries`);
    for (const id of threat.boundaries ?? [])
      if (!boundaryIds.has(id)) fail(`${threat.id} has unknown boundary ${id}`);
    if (threat.response === 'accept' && threat.risk >= 10 && !threat.acceptance) {
      fail(`${threat.id} high/critical acceptance must name an approver and expiry`);
    }
  }
  for (const category of allowedStride)
    if (!seenStride.has(category)) fail(`STRIDE category ${category} is not represented`);

  const expectedChapters = Array.from({ length: 17 }, (_, index) => `V${index + 1}`);
  const chapterIds = chapters.map(({ id }) => id);
  if (chapterIds.join(',') !== expectedChapters.join(','))
    fail('ASVS chapters must contain V1 through V17 exactly once and in order');
  if (duplicateIds(chapterIds).length > 0) fail('ASVS chapter ids must be unique');
  const applicability = new Set(['applicable', 'conditional', 'not-applicable']);
  const asvsPattern = /^v5\.0\.0-(\d+)\.(\d+)\.(\d+)$/;
  const selectedRefs = new Set();
  for (const chapter of chapters) {
    if (!applicability.has(chapter.applicability)) fail(`${chapter.id} has invalid applicability`);
    if (typeof chapter.rationale !== 'string' || chapter.rationale.trim().length < 20)
      fail(`${chapter.id} needs a concrete rationale`);
    if (!Array.isArray(chapter.selectedAsvsRefs))
      fail(`${chapter.id} selectedAsvsRefs must be an array`);
    if (chapter.applicability !== 'not-applicable' && chapter.selectedAsvsRefs.length === 0) {
      fail(`${chapter.id} is applicable/conditional but selects no ASVS requirements`);
    }
    if (chapter.applicability === 'not-applicable' && chapter.selectedAsvsRefs.length !== 0) {
      fail(`${chapter.id} is not applicable but selects ASVS requirements`);
    }
    for (const ref of chapter.selectedAsvsRefs ?? []) {
      const match = asvsPattern.exec(ref);
      if (!match) fail(`${chapter.id} has invalid ASVS reference ${ref}`);
      else if (`V${match[1]}` !== chapter.id)
        fail(`${chapter.id} includes cross-chapter ASVS reference ${ref}`);
      if (selectedRefs.has(ref)) fail(`duplicate selected ASVS reference ${ref}`);
      selectedRefs.add(ref);
    }
  }
  const v17 = chapters.find(({ id }) => id === 'V17');
  if (v17?.applicability !== 'not-applicable' || !v17.rationale.includes('no WebRTC')) {
    fail('V17 must explicitly record the current no-WebRTC rationale');
  }

  const taskText = readFileSync(resolve(root, 'TASKS.md'), 'utf8');
  const taskIds = new Set(
    [...taskText.matchAll(/\*\*([A-Z0-9]+-\d{3})\*\*/g)].map((match) => match[1]),
  );
  const allowedStatuses = new Set(['verified', 'partial', 'planned', 'conditional']);
  const requirementRefs = new Set();
  for (const requirement of requirements) {
    if (!allowedStatuses.has(requirement.status))
      fail(`${requirement.id} has invalid status ${requirement.status}`);
    if (typeof requirement.statement !== 'string' || !requirement.statement.includes('SHALL')) {
      fail(`${requirement.id} must contain a normative SHALL statement`);
    }
    if (typeof requirement.owner !== 'string' || requirement.owner.trim().length === 0)
      fail(`${requirement.id} must have an owner`);
    if (!nonEmptyStrings(requirement.asvsRefs))
      fail(`${requirement.id} must reference ASVS controls`);
    for (const ref of requirement.asvsRefs ?? []) {
      if (!asvsPattern.test(ref)) fail(`${requirement.id} has invalid ASVS reference ${ref}`);
      if (!selectedRefs.has(ref))
        fail(`${requirement.id} references ${ref}, which is not selected by its chapter`);
      requirementRefs.add(ref);
    }
    if (!nonEmptyStrings(requirement.threatRefs))
      fail(`${requirement.id} must reference modeled threats`);
    for (const ref of requirement.threatRefs ?? [])
      if (!threatIds.has(ref)) fail(`${requirement.id} has unknown threat ${ref}`);
    if (!nonEmptyStrings(requirement.evidence))
      fail(`${requirement.id} must contain evidence paths`);
    if (!nonEmptyStrings(requirement.verification))
      fail(`${requirement.id} must define verification`);
    if (!nonEmptyStrings(requirement.taskIds)) fail(`${requirement.id} must link stable tasks`);
    for (const id of requirement.taskIds ?? [])
      if (!taskIds.has(id)) fail(`${requirement.id} has unknown task ${id}`);
    if (requirement.status === 'verified') {
      for (const evidence of requirement.evidence ?? []) {
        if (!existsSync(resolve(root, evidence)))
          fail(`${requirement.id} verified evidence path does not exist: ${evidence}`);
      }
    }
    if (
      requirement.status !== 'verified' &&
      !(requirement.taskIds ?? []).some((id) => id.startsWith('M5-') || id.startsWith('M6-'))
    ) {
      fail(`${requirement.id} unresolved status needs an M5/M6 delivery task`);
    }
  }
  for (const ref of selectedRefs)
    if (!requirementRefs.has(ref))
      fail(`selected ASVS reference ${ref} is not mapped to a GridStory requirement`);

  for (const documentPath of [
    'docs/security/threat-model.md',
    'docs/security/security-requirements.md',
    'docs/security/asvs-v5-profile.md',
  ]) {
    if (!existsSync(resolve(root, documentPath)))
      fail(`required security document is missing: ${documentPath}`);
  }

  return errors;
}

function report(errors) {
  if (errors.length === 0) {
    console.log('GridStory threat model and ASVS 5.0.0 profile are valid.');
    return true;
  }
  for (const error of errors) console.error(`Security model validation failed: ${error}`);
  return false;
}

const threatDocument = readJson(threatPath);
const profileDocument = readJson(profilePath);
const errors = validate(threatDocument, profileDocument);

if (process.argv.includes('--self-test')) {
  const badRisk = structuredClone(threatDocument);
  badRisk.threats[0].risk += 1;
  const badRiskErrors = validate(badRisk, profileDocument);
  if (!badRiskErrors.some((message) => message.includes('risk must equal'))) {
    errors.push('self-test did not detect an inconsistent risk score');
  }
  const badReference = structuredClone(profileDocument);
  badReference.requirements[0].threatRefs = ['THREAT-9999'];
  const badReferenceErrors = validate(threatDocument, badReference);
  if (!badReferenceErrors.some((message) => message.includes('unknown threat'))) {
    errors.push('self-test did not detect an unknown threat reference');
  }
  const duplicateRequirement = structuredClone(profileDocument);
  duplicateRequirement.requirements[1].id = duplicateRequirement.requirements[0].id;
  const duplicateErrors = validate(threatDocument, duplicateRequirement);
  if (!duplicateErrors.some((message) => message.includes('duplicate requirement ids'))) {
    errors.push('self-test did not detect a duplicate requirement id');
  }
  if (errors.length === 0) console.log('Security model negative self-tests passed.');
}

if (!report(errors)) process.exitCode = 1;
