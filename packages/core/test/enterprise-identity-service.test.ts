import { describe, expect, it } from 'vitest';
import { EnterpriseIdentityService } from '../src/enterprise-identity-service.js';
import { InMemoryIdentityRepository } from '../src/identity-repository.js';

const scope = { organizationId: 'org-acme', tenantId: 'tenant-main' };

function harness() {
  const repository = new InMemoryIdentityRepository();
  let sequence = 0;
  let now = new Date('2026-08-21T12:00:00.000Z');
  const service = new EnterpriseIdentityService({
    repository,
    now: () => new Date(now),
    createId: () => `identity-${++sequence}`,
    createSecret: () => `secret-${sequence}-with-enough-entropy`,
  });
  return {
    repository,
    service,
    advance(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

async function federatedSession(service: EnterpriseIdentityService) {
  await service.configureProvider(scope, 'admin-1', {
    id: 'provider-1',
    protocol: 'oidc',
    issuer: 'https://idp.example.test',
    displayName: 'Example Identity',
    enabled: true,
    allowJitProvisioning: true,
  });
  await service.upsertGroupRoleMapping(scope, 'admin-1', {
    id: 'mapping-1',
    externalGroup: 'editors',
    roleId: 'editor',
    workspaceId: 'workspace-1',
    createdBy: 'admin-1',
  });
  return service.completeFederation(scope, {
    identity: {
      providerId: 'provider-1',
      protocol: 'oidc',
      issuer: 'https://idp.example.test',
      subject: 'subject-1',
      email: 'editor@example.test',
      emailVerified: true,
      displayName: 'Enterprise Editor',
      groups: ['editors'],
      authenticatedAt: '2026-08-21T12:00:00.000Z',
      strength: 'multi-factor',
    },
  });
}

describe('EnterpriseIdentityService', () => {
  it('persists one-time federation state and rejects replay', async () => {
    const { service } = harness();
    const transaction = await service.createFederationTransaction(scope, 'oidc');

    await expect(
      service.consumeFederationTransaction(scope, 'oidc', transaction.token),
    ).resolves.toEqual({ nonce: transaction.nonce, codeVerifier: transaction.codeVerifier });
    await expect(
      service.consumeFederationTransaction(scope, 'oidc', transaction.token),
    ).rejects.toMatchObject({ code: 'invalid_identity' });
  });

  it('persists federated sessions and materializes tenant-scoped group roles', async () => {
    const { repository, service } = harness();
    const issued = await federatedSession(service);

    expect(issued.principal).toMatchObject({
      id: issued.session.userId,
      roles: ['editor'],
      roleAssignments: [
        {
          roleId: 'editor',
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          workspaceId: 'workspace-1',
        },
      ],
      authenticationMethod: 'oidc',
    });

    const reopened = new EnterpriseIdentityService({
      repository,
      now: () => new Date('2026-08-21T12:05:00.000Z'),
    });
    const authenticated = await reopened.authenticateSession(scope, issued.token);
    expect(authenticated.session.id).toBe(issued.session.id);
    expect(authenticated.principal.roles).toEqual(['editor']);
    expect((await reopened.snapshot(scope)).securityEvents.map((event) => event.action)).toContain(
      'identity.federation.succeeded',
    );
  });

  it('revokes every durable session when SCIM deprovisions its directory user', async () => {
    const { service } = harness();
    const issued = await federatedSession(service);
    const user = (await service.snapshot(scope)).users[0];
    if (!user) throw new Error('Expected the JIT user fixture.');

    await service.deprovisionUser(scope, 'scim-client', user.id);

    await expect(service.authenticateSession(scope, issued.token)).rejects.toMatchObject({
      code: 'invalid_session',
    });
    expect((await service.snapshot(scope)).sessions[0]).toMatchObject({
      revokedReason: 'user_deprovisioned',
    });
  });

  it('audits provider, policy, and concurrency-enforced session changes exactly', async () => {
    const { service } = harness();
    const first = await federatedSession(service);
    await service.setSessionPolicy(scope, 'admin-1', {
      idleTtlSeconds: 600,
      absoluteTtlSeconds: 3_600,
      reauthenticationSeconds: 600,
      maximumConcurrentSessions: 1,
      privilegedStepUpRequired: true,
      breakGlassTtlSeconds: 300,
      maximumFailedBreakGlassAttempts: 2,
    });
    await federatedSession(service);

    const snapshot = await service.snapshot(scope);
    expect(snapshot.sessions.find((session) => session.id === first.session.id)).toMatchObject({
      revokedReason: 'concurrent_session_limit',
    });
    expect(snapshot.securityEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'identity.provider.configured' }),
        expect.objectContaining({ action: 'identity.policy.updated' }),
        expect.objectContaining({
          action: 'identity.session.revoked',
          subjectId: first.session.id,
          reason: 'concurrent_session_limit',
        }),
      ]),
    );
  });

  it('binds WebAuthn challenges to the user session and persists phishing-resistant step-up', async () => {
    const { service } = harness();
    const issued = await federatedSession(service);
    const userId = issued.session.userId;
    if (!userId) throw new Error('Expected a user-backed session fixture.');
    const registration = await service.createWebAuthnChallenge(scope, {
      userId,
      sessionId: issued.session.id,
      kind: 'registration',
      challenge: 'register-challenge-0001',
    });
    await service.completeWebAuthnRegistration(scope, userId, registration.id, {
      credentialId: 'credential-1',
      publicKey: 'verified-public-key',
      counter: 0,
      transports: ['internal'],
      deviceType: 'multiDevice',
      backedUp: true,
    });
    const authentication = await service.createWebAuthnChallenge(scope, {
      userId,
      sessionId: issued.session.id,
      kind: 'authentication',
      challenge: 'authentication-challenge-0001',
    });

    const steppedUp = await service.completeWebAuthnAuthentication(
      scope,
      userId,
      authentication.id,
      { credentialId: 'credential-1', newCounter: 1 },
    );

    expect(steppedUp).toMatchObject({
      authenticationMethod: 'webauthn',
      authenticationStrength: 'phishing-resistant',
    });
    await expect(
      service.authenticateSession(scope, issued.token, {
        minimumStrength: 'phishing-resistant',
        requireRecentAuthentication: true,
      }),
    ).resolves.toMatchObject({ principal: { authenticationMethod: 'webauthn' } });
  });

  it('rate-limits failed break-glass use and makes successful credentials one-time', async () => {
    const { service } = harness();
    await service.setSessionPolicy(scope, 'admin-1', {
      idleTtlSeconds: 600,
      absoluteTtlSeconds: 3_600,
      reauthenticationSeconds: 600,
      maximumConcurrentSessions: 5,
      privilegedStepUpRequired: true,
      breakGlassTtlSeconds: 300,
      maximumFailedBreakGlassAttempts: 2,
    });
    const locked = await service.createBreakGlassAccount(scope, {
      actorId: 'admin-1',
      name: 'Emergency operator',
      roleId: 'administrator',
      expiresAt: '2026-08-21T13:00:00.000Z',
      incidentId: 'incident-1',
    });
    const wrongToken = locked.token.replace(/\.[^.]+$/, '.incorrect');
    await expect(service.activateBreakGlass(scope, wrongToken, 'incident-1')).rejects.toMatchObject(
      {
        code: 'invalid_token',
      },
    );
    await expect(service.activateBreakGlass(scope, wrongToken, 'incident-1')).rejects.toMatchObject(
      {
        code: 'invalid_token',
      },
    );
    expect((await service.snapshot(scope)).breakGlassAccounts[0]?.status).toBe('revoked');

    const usable = await service.createBreakGlassAccount(scope, {
      actorId: 'admin-1',
      name: 'Second emergency operator',
      roleId: 'administrator',
      expiresAt: '2026-08-21T13:00:00.000Z',
      incidentId: 'incident-2',
    });
    const activated = await service.activateBreakGlass(scope, usable.token, 'incident-2');
    expect(activated.session).toMatchObject({
      authenticationStrength: 'break-glass',
      nonRenewable: true,
    });
    await expect(
      service.activateBreakGlass(scope, usable.token, 'incident-2'),
    ).rejects.toMatchObject({
      code: 'invalid_token',
    });
    expect(
      (await service.snapshot(scope)).securityEvents.filter(
        (event) => event.action === 'identity.break_glass.failed',
      ),
    ).toHaveLength(2);
  });
});
