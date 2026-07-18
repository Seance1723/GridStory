import {
  createSchemaIr,
  createSchemaMigrationPlan,
  detectSchemaDrift,
  generatedTypesFingerprint,
  schemaIrFingerprint,
  validateContent,
  type ComponentManifest,
  type ContentScope,
  type ContentSchemaDefinition,
  type SchemaDriftReport,
  type SchemaIrDocument,
  type SchemaIrDocumentInput,
  type SchemaMigrationPlan,
  type ValidationIssue,
} from '@gridstory/schema';
import { generateTypeScriptContracts } from '@gridstory/schema/typegen';
import { GridStoryError } from './errors.js';
import type { Actor, ContentRepository, SchemaDeployment } from './types.js';

export interface SchemaImpactEntry {
  entryId: string;
  contentType: string;
  issues: ValidationIssue[];
}

export interface SchemaMigrationAssessment {
  plan: SchemaMigrationPlan;
  impact: {
    scannedEntries: number;
    affectedEntries: number;
    byContentType: Record<string, number>;
    invalidEntries: SchemaImpactEntry[];
  };
}

export interface SchemaLifecycleServiceOptions {
  repository: ContentRepository;
  schemas: ContentSchemaDefinition[];
  componentManifests: ComponentManifest[];
}

export class SchemaLifecycleService {
  readonly #repository: ContentRepository;
  readonly #source: SchemaIrDocument;
  readonly #generatedTypes: string;

  constructor({ repository, schemas, componentManifests }: SchemaLifecycleServiceOptions) {
    this.#repository = repository;
    this.#source = createSchemaIr({ schemas, components: componentManifests });
    this.#generatedTypes = generateTypeScriptContracts(
      this.#source.schemas,
      this.#source.components,
    );
  }

  getSource(): SchemaIrDocument {
    return this.#source;
  }

  getGeneratedTypes(): string {
    return this.#generatedTypes;
  }

  async getDeployment(scope: ContentScope): Promise<SchemaDeployment | null> {
    return await this.#repository.getSchemaDeployment({ scope });
  }

  async assess(
    scope: ContentScope,
    candidateInput: SchemaIrDocumentInput = this.#source,
  ): Promise<SchemaMigrationAssessment> {
    const candidate = createSchemaIr({
      schemas: candidateInput.schemas,
      components: candidateInput.components,
    });
    const deployment = await this.getDeployment(scope);
    const before = deployment?.document ?? createSchemaIr({ schemas: [], components: [] });
    const plan = createSchemaMigrationPlan(before, candidate);
    const entries = await this.#repository.list({ scope, perspective: 'draft' });
    const schemas = new Map(candidate.schemas.map((schema) => [schema.id, schema]));
    const invalidEntries: SchemaImpactEntry[] = [];
    const affectedSchemaIds = new Set(
      plan.steps.flatMap((step) => (step.schemaId ? [step.schemaId] : [])),
    );
    const componentsChanged = plan.steps.some((step) => step.componentId);
    let affectedEntries = 0;
    const byContentType: Record<string, number> = {};

    for (const entry of entries) {
      if (componentsChanged || affectedSchemaIds.has(entry.contentType)) {
        affectedEntries += 1;
        byContentType[entry.contentType] = (byContentType[entry.contentType] ?? 0) + 1;
      }
      const schema = schemas.get(entry.contentType);
      const result = schema
        ? validateContent(schema, entry.data, candidate.components)
        : {
            valid: false,
            issues: [
              {
                code: 'invalid_type' as const,
                path: [] as Array<string | number>,
                message: `Content type ${entry.contentType} is removed by this schema.`,
              },
            ],
          };
      if (!result.valid) {
        invalidEntries.push({
          entryId: entry.id,
          contentType: entry.contentType,
          issues: result.issues,
        });
      }
    }

    return {
      plan,
      impact: {
        scannedEntries: entries.length,
        affectedEntries,
        byContentType,
        invalidEntries,
      },
    };
  }

  async deploySource(input: {
    scope: ContentScope;
    actor: Actor;
    expectedPlanId?: string;
    approved?: boolean;
  }): Promise<SchemaDeployment> {
    const assessment = await this.assess(input.scope, this.#source);
    if (assessment.impact.invalidEntries.length > 0) {
      throw new GridStoryError(
        'Schema deployment would leave stored content invalid. Complete the generated backfill hooks first.',
        'schema_migration_data_required',
        409,
        assessment,
      );
    }
    if (
      assessment.plan.approval.required &&
      (!input.approved || input.expectedPlanId !== assessment.plan.id)
    ) {
      throw new GridStoryError(
        'Schema migration approval is required for the exact generated plan.',
        'schema_migration_approval_required',
        409,
        assessment,
      );
    }
    return await this.#repository.saveSchemaDeployment({
      scope: input.scope,
      document: this.#source,
      fingerprint: schemaIrFingerprint(this.#source),
      generatedTypes: this.#generatedTypes,
      generatedTypesFingerprint: generatedTypesFingerprint(this.#source),
      ...(assessment.plan.steps.length > 0 ? { migrationPlanId: assessment.plan.id } : {}),
      actor: input.actor,
    });
  }

  async initialize(scope: ContentScope, actor: Actor): Promise<SchemaDeployment> {
    const current = await this.getDeployment(scope);
    if (current) return current;
    return await this.deploySource({ scope, actor });
  }

  async drift(scope: ContentScope): Promise<SchemaDriftReport> {
    const deployment = await this.getDeployment(scope);
    return detectSchemaDrift({
      source: this.#source,
      ...(deployment
        ? {
            deployed: deployment.document,
            databaseFingerprint: deployment.fingerprint,
            generatedTypes: deployment.generatedTypes,
          }
        : {}),
    });
  }
}
