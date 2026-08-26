import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  bindRequestIdentity,
  bindRequestIdentityMode,
  requestContext,
} from '../src/request-context.js';

function request(): FastifyRequest {
  return {
    headers: {
      'x-gridstory-organization': 'untrusted-org',
      'x-gridstory-tenant': 'untrusted-tenant',
      'x-gridstory-actor': 'spoofed-admin',
      'x-gridstory-roles': 'admin',
      authorization: 'Bearer gsp_invalid',
    },
  } as FastifyRequest;
}

describe('request context identity boundary', () => {
  it('fails closed for private requests without explicitly enabled development mode', () => {
    const unknownMode = request();
    const production = request();
    bindRequestIdentityMode(production, 'production');
    for (const candidate of [unknownMode, production]) {
      expect(() => requestContext(candidate, 'draft')).toThrowError(
        expect.objectContaining({ code: 'invalid_session', statusCode: 401 }),
      );
    }
  });

  it('keeps public production requests anonymous even with untrusted identity headers', () => {
    const production = request();
    bindRequestIdentityMode(production, 'production');
    expect(requestContext(production, 'published', true).principal).toEqual({
      id: 'anonymous',
      type: 'anonymous',
      roles: ['anonymous'],
      authenticationMethod: 'anonymous',
    });
  });

  it('uses only the bound production identity and tenant routing scope', () => {
    const production = request();
    bindRequestIdentityMode(production, 'production');
    const principal = { id: 'verified-user', type: 'user' as const, roles: ['viewer'] };
    bindRequestIdentity(production, {
      organizationId: 'verified-org',
      tenantId: 'verified-tenant',
      principal,
    });
    expect(requestContext(production, 'draft')).toMatchObject({
      organizationId: 'verified-org',
      tenantId: 'verified-tenant',
      principal,
    });
  });

  it('keeps explicit development behavior isolated per request', () => {
    const development = request();
    const production = request();
    bindRequestIdentityMode(development, 'development');
    bindRequestIdentityMode(production, 'production');
    expect(requestContext(development, 'draft').principal).toMatchObject({
      id: 'spoofed-admin',
      roles: ['admin'],
      authenticationMethod: 'development',
    });
    expect(() => requestContext(production, 'draft')).toThrow('An authenticated session');
    expect(requestContext(development, 'draft').principal.authenticationMethod).toBe('development');
  });
});
