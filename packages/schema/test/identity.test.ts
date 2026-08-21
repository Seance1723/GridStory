import { describe, expect, it } from 'vitest';
import {
  defaultSessionPolicy,
  directoryUserSchema,
  groupRoleMappingSchema,
  identitySessionSchema,
  scimPatchSchema,
  sessionPolicySchema,
} from '../src/index.js';

const scope = { organizationId: 'organization-a', tenantId: 'tenant-a' };

describe('enterprise identity contracts', () => {
  it('keeps directory users and group mappings tenant scoped', () => {
    expect(
      directoryUserSchema.parse({
        ...scope,
        id: 'user-a',
        userName: 'author@example.test',
        active: true,
        version: 1,
        createdAt: '2026-08-21T00:00:00.000Z',
        updatedAt: '2026-08-21T00:00:00.000Z',
      }),
    ).toMatchObject({ ...scope, emails: [], providerLinks: [], groupIds: [] });
    expect(() =>
      groupRoleMappingSchema.parse({
        organizationId: '',
        tenantId: 'tenant-a',
        id: 'mapping-a',
        externalGroup: 'authors',
        roleId: 'author',
        createdBy: 'admin-a',
        createdAt: '2026-08-21T00:00:00.000Z',
        updatedAt: '2026-08-21T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('rejects policies whose idle or reauthentication bounds exceed the absolute lifetime', () => {
    expect(sessionPolicySchema.parse(defaultSessionPolicy)).toEqual(defaultSessionPolicy);
    expect(() =>
      sessionPolicySchema.parse({ ...defaultSessionPolicy, idleTtlSeconds: 9 * 60 * 60 }),
    ).toThrow(/Idle session lifetime/);
    expect(() =>
      sessionPolicySchema.parse({
        ...defaultSessionPolicy,
        reauthenticationSeconds: 9 * 60 * 60,
      }),
    ).toThrow(/Reauthentication lifetime/);
  });

  it('models bounded opaque sessions without exposing a credential secret', () => {
    const session = identitySessionSchema.parse({
      ...scope,
      id: 'session-a',
      userId: 'user-a',
      principalId: 'provider|subject',
      createdAt: '2026-08-21T00:00:00.000Z',
      lastSeenAt: '2026-08-21T00:00:00.000Z',
      idleExpiresAt: '2026-08-21T00:30:00.000Z',
      expiresAt: '2026-08-21T08:00:00.000Z',
      reauthenticateAt: '2026-08-21T00:30:00.000Z',
      authenticationMethod: 'saml',
      authenticationStrength: 'multi-factor',
    });
    expect(session).not.toHaveProperty('secret');
    expect(session).not.toHaveProperty('secretHash');
  });

  it('accepts only the bounded SCIM PATCH operation envelope', () => {
    expect(
      scimPatchSchema.parse({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      }).Operations,
    ).toHaveLength(1);
    expect(() =>
      scimPatchSchema.parse({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'move', path: 'active', value: false }],
      }),
    ).toThrow();
  });
});
