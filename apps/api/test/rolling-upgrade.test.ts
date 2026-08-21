import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRollingUpgrade } from '../src/rolling-upgrade.js';
import { buildServer } from '../src/server.js';

describe('rolling-upgrade preflight', () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('accepts distinct live instances with exact health and readiness contracts', async () => {
    const current = await buildServer({ databasePath: ':memory:' });
    const candidate = await buildServer({ databasePath: ':memory:' });
    servers.push(current, candidate);
    const currentUrl = await current.listen({ host: '127.0.0.1', port: 0 });
    const candidateUrl = await candidate.listen({ host: '127.0.0.1', port: 0 });

    await expect(
      checkRollingUpgrade({ currentBaseUrl: currentUrl, candidateBaseUrl: candidateUrl }),
    ).resolves.toEqual({
      status: 'compatible',
      current: { health: 'ok', readiness: 'ready' },
      candidate: { health: 'ok', readiness: 'ready' },
    });
  });

  it('fails closed for duplicate, credentialed, degraded, or widened endpoints', async () => {
    await expect(
      checkRollingUpgrade({
        currentBaseUrl: 'https://api.example.test',
        candidateBaseUrl: 'https://api.example.test',
      }),
    ).rejects.toThrow(/different instances/);
    await expect(
      checkRollingUpgrade({
        currentBaseUrl: 'https://user:secret@current.example.test',
        candidateBaseUrl: 'https://candidate.example.test',
      }),
    ).rejects.toThrow(/without credentials/);

    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('candidate') && url.endsWith('/ready')) {
        return Response.json({ status: 'not_ready', reason: 'schema_drift' }, { status: 503 });
      }
      if (url.endsWith('/health')) {
        return Response.json({ status: 'ok', service: 'gridstory-api', version: 'private' });
      }
      return Response.json({ status: 'ready' });
    };
    await expect(
      checkRollingUpgrade({
        currentBaseUrl: 'https://current.example.test',
        candidateBaseUrl: 'https://candidate.example.test',
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow(/did not match|HTTP 503/);
  });
});
