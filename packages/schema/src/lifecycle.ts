import type { SchemaIrDocument, SchemaIrDocumentInput } from './canonical.js';
import {
  canonicalStringify,
  schemaIrDocumentSchema,
  schemaIrFingerprint,
  sha256,
} from './canonical.js';
import { generateTypeScriptContracts } from './typegen.js';

export type SchemaChangeRisk = 'safe' | 'backfill' | 'destructive';
export type SchemaChangeKind =
  | 'schema-added'
  | 'schema-removed'
  | 'schema-metadata-changed'
  | 'schema-version-changed'
  | 'schema-version-required'
  | 'schema-collection-changed'
  | 'schema-route-changed'
  | 'schema-localization-changed'
  | 'field-added'
  | 'field-removed'
  | 'field-renamed'
  | 'field-type-changed'
  | 'field-required-changed'
  | 'field-constraints-changed'
  | 'field-metadata-changed'
  | 'object-added'
  | 'object-removed'
  | 'object-changed'
  | 'taxonomy-added'
  | 'taxonomy-removed'
  | 'taxonomy-changed'
  | 'component-added'
  | 'component-removed'
  | 'component-version-changed'
  | 'component-version-required'
  | 'component-contract-changed';

export interface SchemaChangeImpact {
  entries: boolean;
  api: boolean;
  components: boolean;
  queries: boolean;
  workflows: boolean;
  searchIndexes: boolean;
}

export interface SchemaChange {
  id: string;
  kind: SchemaChangeKind;
  risk: SchemaChangeRisk;
  schemaId?: string;
  fieldId?: string;
  componentId?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  impact: SchemaChangeImpact;
}

export interface SchemaDiff {
  fromFingerprint: string;
  toFingerprint: string;
  changes: SchemaChange[];
  summary: Record<SchemaChangeRisk, number>;
  compatible: boolean;
}

type NormalizedSchema = SchemaIrDocument['schemas'][number];
type NormalizedField = NormalizedSchema['fields'][number];

function indexById<Value extends { id: string }>(values: Value[]): Map<string, Value> {
  return new Map(values.map((value) => [value.id, value]));
}

function same(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right);
}

function impact(kind: SchemaChangeKind): SchemaChangeImpact {
  const component = kind.startsWith('component-');
  const metadata =
    kind === 'schema-metadata-changed' ||
    kind === 'schema-version-changed' ||
    kind === 'field-metadata-changed';
  const structural = !metadata && !component;
  const fieldApi = kind.startsWith('field-') && kind !== 'field-metadata-changed';
  const localization = kind === 'schema-localization-changed';
  return {
    entries: structural,
    api:
      fieldApi || localization || kind === 'schema-removed' || kind === 'schema-collection-changed',
    components: component,
    queries: fieldApi || localization || kind === 'schema-removed',
    workflows: structural || component,
    searchIndexes: structural,
  };
}

function change(
  kind: SchemaChangeKind,
  risk: SchemaChangeRisk,
  identity: { schemaId?: string; fieldId?: string; componentId?: string },
  summary: string,
  before?: unknown,
  after?: unknown,
): SchemaChange {
  const identityKey = [identity.schemaId, identity.fieldId, identity.componentId]
    .filter(Boolean)
    .join(':');
  return {
    id: `${kind}:${identityKey}`,
    kind,
    risk,
    ...identity,
    summary,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    impact: impact(kind),
  };
}

function fieldConstraints(field: NormalizedField): unknown {
  const { id, name, label, required, type, ...constraints } = field;
  return constraints;
}

function diffFields(
  schemaId: string,
  beforeFields: NormalizedField[],
  afterFields: NormalizedField[],
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const before = indexById(beforeFields);
  const after = indexById(afterFields);
  for (const [fieldId, field] of before) {
    const next = after.get(fieldId);
    if (!next) {
      changes.push(
        change(
          'field-removed',
          'destructive',
          { schemaId, fieldId },
          `Remove field ${field.name}.`,
          field,
        ),
      );
      continue;
    }
    if (field.name !== next.name) {
      changes.push(
        change(
          'field-renamed',
          'backfill',
          { schemaId, fieldId },
          `Rename field ${field.name} to ${next.name}.`,
          field.name,
          next.name,
        ),
      );
    }
    if (field.type !== next.type) {
      changes.push(
        change(
          'field-type-changed',
          'destructive',
          { schemaId, fieldId },
          `Change ${next.name} from ${field.type} to ${next.type}.`,
          field.type,
          next.type,
        ),
      );
      continue;
    }
    if (Boolean(field.required) !== Boolean(next.required)) {
      changes.push(
        change(
          'field-required-changed',
          next.required ? 'backfill' : 'safe',
          { schemaId, fieldId },
          `${next.name} becomes ${next.required ? 'required' : 'optional'}.`,
          Boolean(field.required),
          Boolean(next.required),
        ),
      );
    }
    if (!same(fieldConstraints(field), fieldConstraints(next))) {
      changes.push(
        change(
          'field-constraints-changed',
          'backfill',
          { schemaId, fieldId },
          `Change validation or structure constraints for ${next.name}.`,
          fieldConstraints(field),
          fieldConstraints(next),
        ),
      );
    }
    if (field.label !== next.label) {
      changes.push(
        change(
          'field-metadata-changed',
          'safe',
          { schemaId, fieldId },
          `Change display metadata for ${next.name}.`,
          field.label,
          next.label,
        ),
      );
    }
  }
  for (const [fieldId, field] of after) {
    if (!before.has(fieldId)) {
      changes.push(
        change(
          'field-added',
          field.required ? 'backfill' : 'safe',
          { schemaId, fieldId },
          `Add ${field.required ? 'required' : 'optional'} field ${field.name}.`,
          undefined,
          field,
        ),
      );
    }
  }
  return changes;
}

function diffNamedContracts(
  schemaId: string,
  kind: 'object' | 'taxonomy',
  beforeValues: Array<{ id: string }>,
  afterValues: Array<{ id: string }>,
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const before = indexById(beforeValues);
  const after = indexById(afterValues);
  for (const [id, value] of before) {
    const next = after.get(id);
    if (!next) {
      changes.push(
        change(
          `${kind}-removed`,
          'destructive',
          { schemaId, fieldId: id },
          `Remove ${kind} ${id}.`,
          value,
        ),
      );
    } else if (!same(value, next)) {
      changes.push(
        change(
          `${kind}-changed`,
          'backfill',
          { schemaId, fieldId: id },
          `Change ${kind} ${id}.`,
          value,
          next,
        ),
      );
    }
  }
  for (const [id, value] of after) {
    if (!before.has(id))
      changes.push(
        change(
          `${kind}-added`,
          'safe',
          { schemaId, fieldId: id },
          `Add ${kind} ${id}.`,
          undefined,
          value,
        ),
      );
  }
  return changes;
}

function diffSchemas(
  beforeDocument: SchemaIrDocument,
  afterDocument: SchemaIrDocument,
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const before = indexById(beforeDocument.schemas);
  const after = indexById(afterDocument.schemas);
  for (const [schemaId, schema] of before) {
    const next = after.get(schemaId);
    if (!next) {
      changes.push(
        change(
          'schema-removed',
          'destructive',
          { schemaId },
          `Remove content type ${schema.name}.`,
          schema,
        ),
      );
      continue;
    }
    const schemaChangeStart = changes.length;
    if (schema.name !== next.name || schema.description !== next.description) {
      changes.push(
        change(
          'schema-metadata-changed',
          'safe',
          { schemaId },
          `Change metadata for content type ${schemaId}.`,
          { name: schema.name, description: schema.description },
          { name: next.name, description: next.description },
        ),
      );
    }
    if (schema.collection !== next.collection) {
      changes.push(
        change(
          'schema-collection-changed',
          'destructive',
          { schemaId },
          `Change collection ${schema.collection} to ${next.collection}.`,
          schema.collection,
          next.collection,
        ),
      );
    }
    if (!same(schema.route, next.route)) {
      changes.push(
        change(
          'schema-route-changed',
          'backfill',
          { schemaId },
          `Change canonical route for ${schemaId}.`,
          schema.route,
          next.route,
        ),
      );
    }
    if (!same(schema.localization, next.localization)) {
      changes.push(
        change(
          'schema-localization-changed',
          'backfill',
          { schemaId },
          `Change localized fields for ${schemaId}.`,
          schema.localization,
          next.localization,
        ),
      );
    }
    changes.push(...diffFields(schemaId, schema.fields, next.fields));
    changes.push(...diffNamedContracts(schemaId, 'object', schema.objects, next.objects));
    changes.push(...diffNamedContracts(schemaId, 'taxonomy', schema.taxonomies, next.taxonomies));
    const structuralChanges = changes
      .slice(schemaChangeStart)
      .some(
        (item) => item.kind !== 'schema-metadata-changed' && item.kind !== 'field-metadata-changed',
      );
    if (schema.version !== next.version) {
      changes.push(
        change(
          'schema-version-changed',
          next.version > schema.version ? 'safe' : 'destructive',
          { schemaId },
          `Change schema version ${schema.version} to ${next.version}.`,
          schema.version,
          next.version,
        ),
      );
    } else if (structuralChanges) {
      changes.push(
        change(
          'schema-version-required',
          'destructive',
          { schemaId },
          `Structural changes require advancing schema version ${schema.version}.`,
          schema.version,
          schema.version,
        ),
      );
    }
  }
  for (const [schemaId, schema] of after) {
    if (!before.has(schemaId))
      changes.push(
        change(
          'schema-added',
          'safe',
          { schemaId },
          `Add content type ${schema.name}.`,
          undefined,
          schema,
        ),
      );
  }
  return changes;
}

function diffComponents(
  beforeDocument: SchemaIrDocument,
  afterDocument: SchemaIrDocument,
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const before = indexById(beforeDocument.components);
  const after = indexById(afterDocument.components);
  for (const [componentId, component] of before) {
    const next = after.get(componentId);
    if (!next) {
      changes.push(
        change(
          'component-removed',
          'destructive',
          { componentId },
          `Remove component ${component.name}.`,
          component,
        ),
      );
    } else {
      if (component.version !== next.version)
        changes.push(
          change(
            'component-version-changed',
            'backfill',
            { componentId },
            `Change component ${componentId} from version ${component.version} to ${next.version}.`,
            component.version,
            next.version,
          ),
        );
      if (!same({ ...component, version: 0 }, { ...next, version: 0 })) {
        changes.push(
          change(
            'component-contract-changed',
            'backfill',
            { componentId },
            `Change component contract ${componentId}.`,
            component,
            next,
          ),
        );
        if (component.version === next.version) {
          changes.push(
            change(
              'component-version-required',
              'destructive',
              { componentId },
              `Component contract changes require advancing version ${component.version}.`,
              component.version,
              next.version,
            ),
          );
        }
      }
    }
  }
  for (const [componentId, component] of after) {
    if (!before.has(componentId))
      changes.push(
        change(
          'component-added',
          'safe',
          { componentId },
          `Add component ${component.name}.`,
          undefined,
          component,
        ),
      );
  }
  return changes;
}

export function diffSchemaIr(
  beforeInput: SchemaIrDocumentInput,
  afterInput: SchemaIrDocumentInput,
): SchemaDiff {
  const before = schemaIrDocumentSchema.parse(beforeInput);
  const after = schemaIrDocumentSchema.parse(afterInput);
  const changes = [...diffSchemas(before, after), ...diffComponents(before, after)].sort(
    (left, right) => left.id.localeCompare(right.id),
  );
  const summary = { safe: 0, backfill: 0, destructive: 0 };
  for (const item of changes) summary[item.risk] += 1;
  return {
    fromFingerprint: schemaIrFingerprint(before),
    toFingerprint: schemaIrFingerprint(after),
    changes,
    summary,
    compatible: summary.destructive === 0,
  };
}

export interface MigrationStep {
  id: string;
  changeId: string;
  operation: SchemaChangeKind;
  risk: SchemaChangeRisk;
  summary: string;
  schemaId?: string;
  fieldId?: string;
  componentId?: string;
  reversible: boolean;
  requiresDataScan: boolean;
  backfillHook?: string;
  impact: SchemaChangeImpact;
}

export interface SchemaMigrationPlan {
  id: string;
  fromFingerprint: string;
  toFingerprint: string;
  approval: { required: boolean; reasons: string[] };
  estimate: { lock: 'none' | 'short' | 'long'; dataScanRequired: boolean };
  rollback: { mode: 'automatic' | 'manual' | 'unavailable'; reason: string };
  summary: Record<SchemaChangeRisk, number>;
  steps: MigrationStep[];
}

function hookFor(item: SchemaChange): string | undefined {
  if (item.risk === 'safe') return undefined;
  const identity = [item.schemaId, item.fieldId, item.componentId].filter(Boolean).join('_');
  return `${item.kind.replaceAll('-', '_')}_${identity}`;
}

export function createSchemaMigrationPlan(
  before: SchemaIrDocumentInput,
  after: SchemaIrDocumentInput,
): SchemaMigrationPlan {
  const diff = diffSchemaIr(before, after);
  const steps = diff.changes.map<MigrationStep>((item, index) => {
    const backfillHook = hookFor(item);
    return {
      id: `step-${String(index + 1).padStart(3, '0')}`,
      changeId: item.id,
      operation: item.kind,
      risk: item.risk,
      summary: item.summary,
      ...(item.schemaId ? { schemaId: item.schemaId } : {}),
      ...(item.fieldId ? { fieldId: item.fieldId } : {}),
      ...(item.componentId ? { componentId: item.componentId } : {}),
      reversible: item.risk !== 'destructive',
      requiresDataScan: item.risk !== 'safe' && item.impact.entries,
      ...(backfillHook ? { backfillHook } : {}),
      impact: item.impact,
    };
  });
  const destructive = steps.filter((step) => step.risk === 'destructive');
  const backfill = steps.filter((step) => step.risk === 'backfill');
  const planIdentity = canonicalStringify({
    from: diff.fromFingerprint,
    to: diff.toFingerprint,
    steps,
  });
  return {
    id: `migration_${sha256(planIdentity).slice(0, 20)}`,
    fromFingerprint: diff.fromFingerprint,
    toFingerprint: diff.toFingerprint,
    approval: {
      required: destructive.length > 0 || backfill.length > 0,
      reasons: [...destructive, ...backfill].map((step) => step.summary),
    },
    estimate: {
      lock: destructive.length > 0 ? 'long' : backfill.length > 0 ? 'short' : 'none',
      dataScanRequired: steps.some((step) => step.requiresDataScan),
    },
    rollback: destructive.length
      ? {
          mode: 'unavailable',
          reason: 'At least one destructive step cannot restore removed data.',
        }
      : backfill.length
        ? { mode: 'manual', reason: 'Backfilled content requires an explicit reverse transform.' }
        : { mode: 'automatic', reason: 'All changes are metadata-only or additive.' },
    summary: diff.summary,
    steps,
  };
}

export type DriftSource = 'source' | 'deployed' | 'database' | 'generated-types';
export type DriftStatus = 'match' | 'drift' | 'missing';

export interface DriftState {
  source: DriftSource;
  expectedFingerprint: string;
  actualFingerprint?: string;
  status: DriftStatus;
}

export interface SchemaDriftReport {
  inSync: boolean;
  sourceFingerprint: string;
  expectedGeneratedTypesFingerprint: string;
  states: DriftState[];
}

export interface SchemaDriftInput {
  source: SchemaIrDocumentInput;
  deployed?: SchemaIrDocumentInput | null;
  databaseFingerprint?: string | null;
  generatedTypes?: string | null;
}

export function generatedTypesFingerprint(document: SchemaIrDocumentInput): string {
  const normalized = schemaIrDocumentSchema.parse(document);
  return sha256(generateTypeScriptContracts(normalized.schemas, normalized.components));
}

export function detectSchemaDrift(input: SchemaDriftInput): SchemaDriftReport {
  const sourceFingerprint = schemaIrFingerprint(input.source);
  const expectedGeneratedTypesFingerprint = generatedTypesFingerprint(input.source);
  const deployedFingerprint = input.deployed ? schemaIrFingerprint(input.deployed) : undefined;
  const generatedFingerprint = input.generatedTypes ? sha256(input.generatedTypes) : undefined;
  const state = (
    source: DriftSource,
    expectedFingerprint: string,
    actualFingerprint?: string,
  ): DriftState => ({
    source,
    expectedFingerprint,
    ...(actualFingerprint ? { actualFingerprint } : {}),
    status: !actualFingerprint
      ? 'missing'
      : actualFingerprint === expectedFingerprint
        ? 'match'
        : 'drift',
  });
  const states = [
    state('source', sourceFingerprint, sourceFingerprint),
    state('deployed', sourceFingerprint, deployedFingerprint),
    state('database', sourceFingerprint, input.databaseFingerprint ?? undefined),
    state('generated-types', expectedGeneratedTypesFingerprint, generatedFingerprint),
  ];
  return {
    inSync: states.every((item) => item.status === 'match'),
    sourceFingerprint,
    expectedGeneratedTypesFingerprint,
    states,
  };
}
