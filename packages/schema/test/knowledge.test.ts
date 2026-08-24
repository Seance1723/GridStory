import { describe, expect, it } from 'vitest';
import {
  knowledgeAgentPolicyInputSchema,
  knowledgeAgentRuntimePlanSchema,
  knowledgeDocumentSchema,
  knowledgeGraphQuerySchema,
} from '../src/index.js';

const scope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

describe('knowledge and reviewed-agent contracts', () => {
  it('bounds graph traversal and rejects duplicate seeds', () => {
    expect(
      knowledgeGraphQuerySchema.parse({
        seedEntryIds: ['page-a'],
        maximumDepth: 3,
        maximumNodes: 20,
        maximumEdges: 30,
      }),
    ).toMatchObject({ perspective: 'draft', direction: 'both' });
    expect(() => knowledgeGraphQuerySchema.parse({ seedEntryIds: ['page-a', 'page-a'] })).toThrow();
    expect(() =>
      knowledgeGraphQuerySchema.parse({ seedEntryIds: ['page-a'], maximumDepth: 4 }),
    ).toThrow();
  });

  it('permits only strict fixed-contract draft plans and bounded policies', () => {
    expect(
      knowledgeAgentPolicyInputSchema.parse({
        expectedVersion: 0,
        policy: {
          enabled: true,
          adapterId: 'runtime-a',
          modelId: 'small',
          promptId: 'knowledge-plan',
          promptVersion: 1,
          fieldRules: [{ contentType: 'page', fieldPaths: ['title'] }],
          tools: ['content.get'],
          maximumToolCalls: 2,
          timeoutMs: 1_000,
          planLifetimeSeconds: 300,
        },
      }),
    ).toMatchObject({ policy: { enabled: true } });
    const plan = {
      contract: 'gridstory.agent-draft-plan.v1',
      summary: 'Tighten the title.',
      targetEntryId: 'page-a',
      expectedDraftRevisionId: 'revision-a',
      changes: [{ fieldPath: 'title', value: 'Reviewed title', rationale: 'Clearer.' }],
    };
    expect(knowledgeAgentRuntimePlanSchema.parse(plan)).toEqual(plan);
    expect(() => knowledgeAgentRuntimePlanSchema.parse({ ...plan, publish: true })).toThrow();
  });

  it('keeps durable state complete-scope and excludes raw tool/provider payloads', () => {
    const document = knowledgeDocumentSchema.parse({
      ...scope,
      schemaVersion: 1,
      version: 0,
      policy: { enabled: false },
      plans: [],
      receipts: [],
      updatedAt: '2026-08-24T08:00:00.000Z',
      updatedBy: 'system',
    });
    expect(document.policy.enabled).toBe(false);
    expect(() => knowledgeDocumentSchema.parse({ ...document, rawToolOutput: 'secret' })).toThrow();
    expect(() => knowledgeDocumentSchema.parse({ ...document, tenantId: undefined })).toThrow();
  });
});
