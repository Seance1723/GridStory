import { studioDestinations, studioOperations } from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import { createGridStoryClient } from '../src/index.js';

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Required fixture value is missing.');
  return value;
}

const scope = {
  organizationId: 'org',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  siteId: 'site',
  environmentId: 'dev',
  locale: 'en',
};
const response = (selectedScope = scope) => ({
  version: 1,
  scope: selectedScope,
  principalId: 'caller',
  capabilities: {
    screens: Object.fromEntries(studioDestinations.map((key) => [key, false])),
    operations: Object.fromEntries(studioOperations.map((key) => [key, false])),
  },
  selection: { mode: 'current-only', choices: [] },
});

describe('Studio context client', () => {
  it.each([true, false])(
    'clones scope immutably, preserving custom transport and development mode %s',
    async (developmentIdentityHeaders) => {
      const requests: RequestInit[] = [];
      const urls: string[] = [];
      const fetcher: typeof fetch = async (input, init) => {
        urls.push(String(input));
        requests.push(required(init));
        const headers = new Headers(init?.headers);
        return Response.json(
          response({
            ...scope,
            siteId: required(headers.get('x-gridstory-site')),
            environmentId: required(headers.get('x-gridstory-environment')),
            locale: required(headers.get('x-gridstory-locale')),
          }),
        );
      };
      const original = createGridStoryClient({
        baseUrl: 'https://cms.example.test/',
        tenantId: scope.tenantId,
        scope,
        actorId: 'fixture-actor',
        developmentIdentityHeaders,
        fetch: fetcher,
      });
      const selection = { siteId: 'site-two', environmentId: 'prod', locale: 'fr' };
      const clone = original.withStudioScope(selection);
      selection.siteId = 'mutated';
      const controller = new AbortController();
      const result = await clone.getStudioContext({ signal: controller.signal });
      await original.getStudioContext();
      expect(result.scope).toEqual({
        ...scope,
        siteId: 'site-two',
        environmentId: 'prod',
        locale: 'fr',
      });
      expect(urls).toEqual([
        'https://cms.example.test/api/v1/studio/context',
        'https://cms.example.test/api/v1/studio/context',
      ]);
      for (const request of requests) {
        expect(request.credentials).toBe('include');
        const headers = new Headers(request.headers);
        expect(headers.get('x-gridstory-organization')).toBe('org');
        expect(headers.get('x-gridstory-tenant')).toBe('tenant');
        expect(headers.get('x-gridstory-workspace')).toBe('workspace');
        expect(headers.get('x-gridstory-actor')).toBe(
          developmentIdentityHeaders ? 'fixture-actor' : null,
        );
      }
      expect(required(requests[0]).signal).toBe(controller.signal);
      expect(new Headers(required(requests[1]).headers).get('x-gridstory-site')).toBe('site');
      expect(() => original.withStudioScope({ ...selection, tenantId: 'other' } as never)).toThrow(
        TypeError,
      );
    },
  );

  it('rejects unknown, incomplete and wrong-scope responses instead of falling back', async () => {
    for (const body of [
      {},
      { ...response(), version: 2 },
      response({ ...scope, tenantId: 'other' }),
      { ...response(), roles: ['admin'] },
    ]) {
      const client = createGridStoryClient({
        baseUrl: 'https://cms.example.test',
        tenantId: 'tenant',
        scope,
        fetch: async () => Response.json(body),
      });
      await expect(client.getStudioContext()).rejects.toMatchObject({
        code: 'invalid_studio_context',
        status: 502,
      });
    }
  });

  it('preserves server denial and cancellation without retrying legacy context', async () => {
    let calls = 0;
    const client = createGridStoryClient({
      baseUrl: 'https://cms.example.test',
      tenantId: 'tenant',
      scope,
      fetch: async () => {
        calls++;
        return Response.json(
          { error: { code: 'invalid_session', message: 'Session required.' } },
          { status: 401 },
        );
      },
    });
    await expect(client.getStudioContext()).rejects.toMatchObject({
      status: 401,
      code: 'invalid_session',
    });
    expect(calls).toBe(1);
    const cancelled = new AbortController();
    cancelled.abort();
    const aborting = createGridStoryClient({
      baseUrl: 'https://cms.example.test',
      tenantId: 'tenant',
      scope,
      fetch: async (_input, init) => {
        init?.signal?.throwIfAborted();
        return Response.json(response());
      },
    });
    await expect(
      aborting
        .withStudioScope({ siteId: 'site', environmentId: 'dev', locale: 'en' })
        .getStudioContext({ signal: cancelled.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
