import { EnterpriseIdentityService, InMemoryIdentityRepository } from '@gridstory/core';
import { describe, expect, it } from 'vitest';
import { SamlFederationAdapter } from '../src/identity-adapters.js';

describe('enterprise protocol adapters', () => {
  it('binds SAML requests to durable RelayState and rejects invalid or replayed responses', async () => {
    const identity = new EnterpriseIdentityService({
      repository: new InMemoryIdentityRepository(),
    });
    const scope = { organizationId: 'org-enterprise', tenantId: 'tenant-enterprise' };
    const adapter = new SamlFederationAdapter(
      {
        id: 'workforce-saml',
        protocol: 'saml',
        issuer: 'https://identity.example.test/saml',
        entryPoint: 'https://identity.example.test/saml/login',
        idpCertificate: 'MIIB',
        serviceProviderIssuer: 'https://cms.example.test/saml/metadata',
        callbackUrl: 'https://cms.example.test/api/v1/identity/federation/workforce-saml/callback',
      },
      identity,
    );

    const authorizationUrl = new URL(await adapter.start(scope));
    const relayState = authorizationUrl.searchParams.get('RelayState');
    expect(authorizationUrl.origin).toBe('https://identity.example.test');
    expect(authorizationUrl.searchParams.get('SAMLRequest')).toBeTruthy();
    expect(relayState).toMatch(/^gft_/);
    if (!relayState) throw new Error('Expected a SAML RelayState fixture.');

    await expect(
      adapter.complete(scope, {
        body: {
          RelayState: relayState,
          SAMLResponse: Buffer.from('<invalid/>').toString('base64'),
        },
      }),
    ).rejects.toBeTruthy();
    await expect(
      adapter.complete(scope, {
        body: {
          RelayState: relayState,
          SAMLResponse: Buffer.from('<invalid/>').toString('base64'),
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_identity' });
  });
});
