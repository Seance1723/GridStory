import { describe, expect, it } from 'vitest';
import {
  aiGatewayDocumentSchema,
  aiGenerateInputSchema,
  aiProviderRequestSchema,
} from '../src/index.js';

const scope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

describe('AI gateway contracts', () => {
  it('keeps complete scope and invocation history metadata-only', () => {
    const document = aiGatewayDocumentSchema.parse({
      ...scope,
      schemaVersion: 1,
      version: 0,
      state: 'disabled',
      models: [],
      budgets: {
        dailyRequests: 10,
        dailyInputTokens: 1_000,
        dailyOutputTokens: 1_000,
        dailyCostMicros: 1_000,
      },
      promptVersions: [],
      activePrompts: [],
      dailyUsage: [],
      receipts: [],
      stateEvents: [],
      updatedAt: '2026-08-24T08:00:00.000Z',
    });
    expect(document.state).toBe('disabled');
    expect(() => aiGatewayDocumentSchema.parse({ ...document, rawOutputs: ['secret'] })).toThrow();
    expect(() => aiGatewayDocumentSchema.parse({ ...document, tenantId: undefined })).toThrow();
  });

  it('requires unique explicit sources and rejects uncontracted execution fields', () => {
    const input = {
      requestId: '018daf23-89b3-7cf8-a4f1-94064c96df90',
      promptId: 'summary',
      providerId: 'test',
      modelId: 'small',
      input: 'Summarize this entry.',
      sourceIds: ['home'],
    };
    expect(aiGenerateInputSchema.parse(input)).toEqual(input);
    expect(() => aiGenerateInputSchema.parse({ ...input, sourceIds: ['home', 'home'] })).toThrow();
    expect(() => aiGenerateInputSchema.parse({ ...input, tools: ['publish'] })).toThrow();
  });

  it('keeps provider requests structured and free of tenant routing fields', () => {
    const request = aiProviderRequestSchema.parse({
      requestId: '018daf23-89b3-7cf8-a4f1-94064c96df90',
      providerId: 'test',
      modelId: 'small',
      prompt: { id: 'summary', version: 1, instructions: 'Return a concise summary.' },
      input: 'Summarize the sources.',
      sources: [
        {
          id: 'home',
          contentType: 'page',
          revisionId: 'revision-1',
          fields: { title: 'Home' },
        },
      ],
      maximumOutputTokens: 100,
      timeoutMs: 1_000,
    });
    expect(request.sources[0]?.fields).toEqual({ title: 'Home' });
    expect(() => aiProviderRequestSchema.parse({ ...request, tenantId: 'tenant-a' })).toThrow();
  });
});
