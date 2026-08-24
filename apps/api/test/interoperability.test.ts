import type { FleetObservationAdapter } from '@gridstory/core';
import { createInteroperabilityDiscovery, type ContentScope } from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpGridStoryFleetObserver } from '../src/fleet-adapter.js';
import { buildServer } from '../src/server.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

function headers(roles = 'admin', tenantId = scope.tenantId) {
  return {
    'content-type': 'application/json',
    'x-gridstory-organization': scope.organizationId,
    'x-gridstory-tenant': tenantId,
    'x-gridstory-workspace': scope.workspaceId,
    'x-gridstory-site': scope.siteId,
    'x-gridstory-environment': scope.environmentId,
    'x-gridstory-locale': scope.locale,
    'x-gridstory-actor': 'operator',
    'x-gridstory-roles': roles,
  };
}

describe('interoperability and fleet routes', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('serves minimized public discovery and immutable generated specifications without scope headers', async () => {
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      fleet: { instanceId: 'public-instance', serviceVersion: '8.4.0' },
    });
    const discoveryResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/interoperability',
    });
    expect(discoveryResponse.statusCode).toBe(200);
    expect(discoveryResponse.headers['cache-control']).toBe('public, max-age=60');
    expect(discoveryResponse.headers.etag).toMatch(/^"sha256-[a-f0-9]{64}"$/u);
    expect(discoveryResponse.json()).toMatchObject({
      format: 'gridstory.interoperability',
      protocolVersion: 1,
      instanceId: 'public-instance',
      serviceVersion: '8.4.0',
    });
    expect(discoveryResponse.json().specifications).toHaveLength(4);
    expect(discoveryResponse.body).not.toMatch(
      /"(?:organizationId|tenantId|workspaceId|siteId|environmentId|locale|credential|token|draftRevisionId)"/u,
    );
    const cached = await server.inject({
      method: 'GET',
      url: '/api/v1/interoperability',
      headers: { 'if-none-match': String(discoveryResponse.headers.etag) },
    });
    expect(cached.statusCode).toBe(304);

    const specification = await server.inject({
      method: 'GET',
      url: '/api/v1/interoperability/specifications/preview-source-map/1',
    });
    expect(specification.statusCode).toBe(200);
    expect(specification.headers['content-type']).toContain('application/schema+json');
    expect(specification.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(specification.json()).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'urn:gridstory:spec:preview-source-map:1',
    });
  });

  it('keeps fleet state private, scoped, separately authorized, and pull-only', async () => {
    const remote = createInteroperabilityDiscovery({
      instanceId: 'remote-instance',
      serviceVersion: '8.4.0',
    });
    const observer: FleetObservationAdapter = {
      id: 'remote-observer',
      observe: () => ({
        discovery: remote,
        health: { status: 'ok', service: 'gridstory-api' },
        readiness: { status: 'ready' },
        observedAt: new Date(Date.now() - 1_000).toISOString(),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    };
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      fleet: {
        instanceId: 'local-instance',
        serviceVersion: '8.4.0',
        observers: [observer],
      },
    });
    const empty = await server.inject({
      method: 'GET',
      url: '/api/v1/fleet',
      headers: headers('viewer'),
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.headers['cache-control']).toBe('private, no-store');
    expect(empty.json().members).toEqual([]);

    const denied = await server.inject({
      method: 'PUT',
      url: '/api/v1/fleet/members/remote-primary',
      headers: headers('viewer'),
      payload: {
        expectedVersion: 0,
        label: 'Remote primary',
        adapterId: 'remote-observer',
        expectedInstanceId: 'remote-instance',
      },
    });
    expect(denied.statusCode).toBe(403);

    const registered = await server.inject({
      method: 'PUT',
      url: '/api/v1/fleet/members/remote-primary',
      headers: headers('publisher'),
      payload: {
        expectedVersion: 0,
        label: 'Remote primary',
        adapterId: 'remote-observer',
        expectedInstanceId: 'remote-instance',
        expectedServiceVersion: '8.4.0',
      },
    });
    expect(registered.statusCode).toBe(200);
    const checked = await server.inject({
      method: 'POST',
      url: '/api/v1/fleet/members/remote-primary/check',
      headers: headers('publisher'),
      payload: { expectedVersion: registered.json().version },
    });
    expect(checked.statusCode).toBe(200);
    expect(checked.json().observations[0].conditions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'Compatible', status: 'true' })]),
    );
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/v1/fleet',
          headers: headers('viewer', 'tenant-b'),
        })
      ).json().members,
    ).toEqual([]);
  });
});

describe('HttpGridStoryFleetObserver', () => {
  it('accepts only a credential-free HTTPS origin and performs bounded same-origin GETs', async () => {
    expect(
      () => new HttpGridStoryFleetObserver({ id: 'bad', baseUrl: 'http://example.test' }),
    ).toThrow(/HTTPS origin/u);
    expect(
      () =>
        new HttpGridStoryFleetObserver({ id: 'bad', baseUrl: 'https://user:pass@example.test' }),
    ).toThrow(/HTTPS origin/u);
    expect(
      () => new HttpGridStoryFleetObserver({ id: 'bad', baseUrl: 'https://example.test/base' }),
    ).toThrow(/HTTPS origin/u);

    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const values = new Map([
      [
        '/api/v1/interoperability',
        {
          value: createInteroperabilityDiscovery({ instanceId: 'remote', serviceVersion: '1.0.0' }),
        },
      ],
      ['/health', { value: { status: 'ok', service: 'gridstory-api' } }],
      ['/ready', { value: { status: 'ready' } }],
    ]);
    const observer = new HttpGridStoryFleetObserver({
      id: 'remote',
      baseUrl: 'https://fleet.example.test',
      now: () => new Date('2026-08-24T12:00:00.000Z'),
      fetch: (async (input, init) => {
        const url = new URL(String(input));
        requests.push({ url: url.toString(), init });
        const fixture = values.get(url.pathname);
        return new Response(JSON.stringify(fixture?.value), {
          status: fixture ? 200 : 404,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    });
    const observed = await observer.observe({ signal: new AbortController().signal });
    expect(observed).toMatchObject({
      observedAt: '2026-08-24T12:00:00.000Z',
      expiresAt: '2026-08-24T12:05:00.000Z',
    });
    expect(requests.map((request) => request.url)).toEqual([
      'https://fleet.example.test/api/v1/interoperability',
      'https://fleet.example.test/health',
      'https://fleet.example.test/ready',
    ]);
    for (const request of requests) {
      expect(request.init?.method).toBe('GET');
      expect(request.init?.redirect).toBe('error');
      expect(new Headers(request.init?.headers).has('authorization')).toBe(false);
      expect([...new Headers(request.init?.headers).keys()]).toEqual(['accept']);
    }
  });
});
