import { describe, expect, it } from 'vitest';
import { editorialOverviewSchema } from '../src/editorial-overview.js';

const scope = {
  organizationId: 'org',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  siteId: 'site',
  environmentId: 'environment',
  locale: 'en',
};

function overview() {
  return {
    version: 1 as const,
    scope,
    generatedAt: '2026-08-29T00:00:00.000Z',
    widgets: {
      content: {
        availability: 'available' as const,
        coverage: 'all-registered' as const,
        exact: true as const,
        bounds: { totalCount: 1, displayedCount: 1, limit: 5 as const, hasMore: false },
        states: { draft: 1, changed: 0, published: 0 },
        recent: [
          {
            id: 'entry',
            contentType: 'article',
            title: 'Entry',
            status: 'draft' as const,
            updatedAt: '2026-08-29T00:00:00.000Z',
            destination: 'collections' as const,
          },
        ],
      },
      reviews: { availability: 'unavailable' as const },
      releases: { availability: 'error' as const, reason: 'source-unavailable' as const },
      operations: { availability: 'unavailable' as const },
    },
  };
}

describe('editorial overview contract', () => {
  it('accepts strict minimized widgets with explicit bounds', () => {
    expect(editorialOverviewSchema.parse(overview())).toEqual(overview());
  });

  it('rejects inconsistent totals, bounds and extra private fields', () => {
    const inconsistent = overview();
    inconsistent.widgets.content.bounds.totalCount = 2;
    expect(editorialOverviewSchema.safeParse(inconsistent).success).toBe(false);

    const leaking = overview() as ReturnType<typeof overview> & { principal?: unknown };
    leaking.principal = { roles: ['admin'] };
    expect(editorialOverviewSchema.safeParse(leaking).success).toBe(false);
  });
});
