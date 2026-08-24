import { describe, expect, it } from 'vitest';
import {
  aiAuthoringDocumentSchema,
  aiAuthoringPolicyInputSchema,
  aiAuthoringProviderOutputSchema,
  aiSemanticQuerySchema,
} from '../src/index.js';

const scope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

const action = {
  id: 'summarize-title',
  name: 'Summarize title',
  enabled: true,
  promptId: 'summary',
  contentType: 'page',
  targetFields: ['title'],
  maximumChanges: 1,
  evaluationRules: [
    { id: 'title-length', fieldPath: 'title', kind: 'maximum-length' as const, maximum: 80 },
  ],
};

describe('AI authoring contracts', () => {
  it('accepts only the fixed, bounded, unique field-suggestion contract', () => {
    const output = {
      contract: 'gridstory.authoring-suggestions.v1',
      suggestions: [{ fieldPath: 'title', value: 'A safer title', rationale: 'More concise.' }],
    };
    expect(aiAuthoringProviderOutputSchema.parse(output)).toEqual(output);
    expect(() =>
      aiAuthoringProviderOutputSchema.parse({
        ...output,
        contract: 'arbitrary.v2',
      }),
    ).toThrow();
    expect(() =>
      aiAuthoringProviderOutputSchema.parse({
        ...output,
        suggestions: [output.suggestions[0], output.suggestions[0]],
      }),
    ).toThrow();
    expect(() => aiAuthoringProviderOutputSchema.parse({ ...output, publish: true })).toThrow();
  });

  it('requires unique actions and rules bound to declared target fields', () => {
    const input = {
      expectedVersion: 0,
      state: 'enabled',
      actions: [action],
      semantic: { enabled: false as const },
    };
    expect(aiAuthoringPolicyInputSchema.parse(input)).toEqual(input);
    expect(() =>
      aiAuthoringPolicyInputSchema.parse({ ...input, actions: [action, action] }),
    ).toThrow();
    expect(() =>
      aiAuthoringPolicyInputSchema.parse({
        ...input,
        actions: [
          {
            ...action,
            evaluationRules: [
              { id: 'body-length', fieldPath: 'body', kind: 'maximum-length', maximum: 80 },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it('keeps authoring documents complete-scope and excludes raw provider/source/query data', () => {
    const document = aiAuthoringDocumentSchema.parse({
      ...scope,
      schemaVersion: 1,
      version: 0,
      state: 'disabled',
      actions: [],
      semantic: { enabled: false },
      proposals: [],
      updatedAt: '2026-08-24T08:00:00.000Z',
    });
    expect(document.state).toBe('disabled');
    expect(() => aiAuthoringDocumentSchema.parse({ ...document, tenantId: undefined })).toThrow();
    expect(() =>
      aiAuthoringDocumentSchema.parse({ ...document, rawProviderOutput: 'secret' }),
    ).toThrow();
    expect(() =>
      aiSemanticQuerySchema.parse({ text: 'find this', perspective: 'draft' }),
    ).toThrow();
  });
});
