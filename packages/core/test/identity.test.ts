import { describe, expect, it } from 'vitest';
import { GridStoryActions, GridStoryError, IdentityService } from '../src/index.js';

const now = new Date('2026-07-17T00:00:00.000Z');
const identity = {
  issuer: 'https://identity.example',
  subject: 'user-1',
  audience: ['gridstory-studio'],
  email: 'editor@example.test',
  groups: ['cms-editors'],
  issuedAt: Math.floor(now.getTime() / 1000) - 10,
  expiresAt: Math.floor(now.getTime() / 1000) + 3600,
};

function service() {
  let sequence = 0;
  return new IdentityService({
    trustedIssuers: ['https://identity.example'],
    audiences: ['gridstory-studio'],
    groupRoleMap: { 'cms-editors': ['author'] },
    now: () => now,
    createId: () => `id-${++sequence}`,
    createSecret: () => 'test-secret',
  });
}

describe('IdentityService', () => {
  it('creates a revocable session from cryptographically verified OIDC identity data', async () => {
    const identities = service();
    const result = await identities.authenticateOidc('verified-id-token', 'tenant-a', {
      verify: async () => identity,
    });
    expect(result.principal.roles).toEqual(['author']);
    expect(identities.getSession(result.session.id).tenantId).toBe('tenant-a');
    identities.revokeSession(result.session.id);
    expect(() => identities.getSession(result.session.id)).toThrow(GridStoryError);
  });

  it('rejects identity data from an untrusted issuer after verifier handoff', async () => {
    await expect(
      service().authenticateOidc('token', 'tenant-a', {
        verify: async () => ({ ...identity, issuer: 'https://attacker.example' }),
      }),
    ).rejects.toMatchObject({ code: 'invalid_identity', statusCode: 401 });
  });

  it('issues hashed opaque service tokens and supports authentication and revocation', () => {
    const identities = service();
    const account = identities.createServiceAccount({
      tenantId: 'tenant-a',
      name: 'Publisher bot',
      grants: [{ actions: [GridStoryActions.contentPublish], tenantId: 'tenant-a' }],
    });
    const issued = identities.issueServiceToken(account.id);
    expect(issued.token).toContain('test-secret');
    expect(identities.authenticateServiceToken(issued.token).grants).toEqual(account.grants);
    identities.revokeServiceToken(issued.claims.tokenId);
    expect(() => identities.authenticateServiceToken(issued.token)).toThrow(GridStoryError);
  });
});
