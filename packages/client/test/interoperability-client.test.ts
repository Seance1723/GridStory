import { describe, expect, it } from 'vitest';
import { createGridStoryClient } from '../src/index.js';

describe('GridStoryClient interoperability and fleet operations', () => {
  it('keeps public reads credential/scope-free and fleet operations private and typed', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'https://cms.example.test',
      tenantId: 'fleet-tenant',
      actorId: 'operator-a',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({ version: 1 }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.getInteroperabilityDiscovery();
    await client.getInteroperabilitySpecification('preview-source-map');
    await client.getFleet();
    await client.upsertFleetMember('remote/primary', {
      expectedVersion: 0,
      label: 'Remote primary',
      adapterId: 'remote-primary',
      expectedInstanceId: 'remote-instance',
    });
    await client.setFleetMemberState('remote/primary', { expectedVersion: 1, state: 'paused' });
    await client.checkFleetMember('remote/primary', { expectedVersion: 2 });
    await client.removeFleetMember('remote/primary', { expectedVersion: 3 });

    expect(requests.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['GET', 'https://cms.example.test/api/v1/interoperability'],
      [
        'GET',
        'https://cms.example.test/api/v1/interoperability/specifications/preview-source-map/1',
      ],
      ['GET', 'https://cms.example.test/api/v1/fleet'],
      ['PUT', 'https://cms.example.test/api/v1/fleet/members/remote%2Fprimary'],
      ['POST', 'https://cms.example.test/api/v1/fleet/members/remote%2Fprimary/state'],
      ['POST', 'https://cms.example.test/api/v1/fleet/members/remote%2Fprimary/check'],
      ['DELETE', 'https://cms.example.test/api/v1/fleet/members/remote%2Fprimary'],
    ]);
    for (const request of requests.slice(0, 2)) {
      expect(request.init?.credentials).toBe('omit');
      const publicHeaders = new Headers(request.init?.headers);
      expect(publicHeaders.has('x-gridstory-tenant')).toBe(false);
      expect(publicHeaders.has('x-gridstory-actor')).toBe(false);
      expect(publicHeaders.has('authorization')).toBe(false);
    }
    expect(requests[2]?.init?.headers).toMatchObject({
      'x-gridstory-tenant': 'fleet-tenant',
      'x-gridstory-actor': 'operator-a',
    });
    expect(JSON.parse(String(requests[6]?.init?.body))).toEqual({ expectedVersion: 3 });
  });
});
