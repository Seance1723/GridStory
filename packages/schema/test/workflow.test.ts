import { describe, expect, it } from 'vitest';
import { workflowDefinitionInputSchema } from '../src/index.js';

const definition = {
  name: 'Localized legal review',
  contentType: 'page',
  version: 3,
  initialStateId: 'draft',
  states: [
    { id: 'draft', label: 'Draft', kind: 'draft' },
    { id: 'legal-review', label: 'Legal review', kind: 'review' },
    { id: 'published', label: 'Published', kind: 'published' },
  ],
  transitions: [
    {
      id: 'request-legal',
      label: 'Request legal review',
      from: 'draft',
      to: 'legal-review',
      allowedRoles: ['author'],
      approval: {
        minimumApprovals: 2,
        allowedRoles: ['legal-reviewer'],
        separationOfDuties: true,
        dueAfterHours: 48,
        escalateToRoles: ['legal-lead'],
        fields: ['legalDisclaimer'],
        locales: ['en-GB'],
      },
    },
    {
      id: 'publish',
      label: 'Publish',
      from: 'legal-review',
      to: 'published',
      allowedRoles: ['publisher'],
    },
  ],
};

describe('workflow definition contract', () => {
  it('normalizes approval policy defaults and preserves field/locale conditions', () => {
    expect(workflowDefinitionInputSchema.parse(definition)).toMatchObject({
      version: 3,
      transitions: [
        {
          approval: {
            minimumApprovals: 2,
            separationOfDuties: true,
            fields: ['legalDisclaimer'],
            locales: ['en-GB'],
          },
        },
        { id: 'publish' },
      ],
    });
  });

  it('normalizes durable transition actions and rejects duplicate action IDs', () => {
    const withActions = {
      ...definition,
      transitions: definition.transitions.map((transition) =>
        transition.id === 'request-legal'
          ? {
              ...transition,
              actions: [
                {
                  id: 'notify-legal',
                  label: 'Notify legal',
                  type: 'notification' as const,
                  message: 'Legal review is ready.',
                  audienceRoles: ['legal-reviewer'],
                },
              ],
            }
          : transition,
      ),
    };
    const parsed = workflowDefinitionInputSchema.parse(withActions);
    expect(parsed.transitions[0]?.actions[0]).toMatchObject({
      id: 'notify-legal',
      type: 'notification',
      maxAttempts: 5,
    });
    const duplicate = {
      ...withActions,
      transitions: withActions.transitions.map((transition) =>
        transition.id === 'request-legal' && transition.actions
          ? { ...transition, actions: [...transition.actions, transition.actions[0]] }
          : transition,
      ),
    };
    const result = workflowDefinitionInputSchema.safeParse(duplicate);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'Workflow action IDs must be unique within a transition.',
      );
    }
  });

  it('rejects dangling transitions, duplicate states, and missing published state', () => {
    const invalid = {
      ...definition,
      states: [
        { id: 'draft', label: 'Draft', kind: 'draft' },
        { id: 'draft', label: 'Duplicate', kind: 'review' },
      ],
    };
    const result = workflowDefinitionInputSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          'Workflow state IDs must be unique.',
          'Transitions must reference declared states.',
          'A workflow must declare exactly one published state.',
        ]),
      );
    }
  });
});
