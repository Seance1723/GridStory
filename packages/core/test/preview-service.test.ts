import { describe, expect, it } from 'vitest';
import { PreviewSessionService } from '../src/index.js';

const scope = {
  organizationId: 'acme',
  tenantId: 'tenant',
  workspaceId: 'marketing',
  siteId: 'website',
  environmentId: 'preview',
  locale: 'en',
};

describe('PreviewSessionService', () => {
  it('issues origin/scope-bound grants and verifies signatures and expiry', () => {
    let now = 100;
    const service = new PreviewSessionService({
      signingSecret: 'preview-test-secret-with-at-least-32-characters',
      allowedOrigins: ['https://preview.example.test'],
      now: () => now,
      createId: () => 'session-1',
    });
    const grant = service.create({
      scope,
      previewUrl: 'https://preview.example.test/gridstory-preview',
      route: '/welcome',
      mode: 'iframe',
      entryId: 'page-1',
      ttlSeconds: 30,
    });

    expect(grant.previewUrl).not.toContain(grant.token);
    expect(service.authenticate(grant.token, 'https://preview.example.test/app')).toMatchObject({
      sessionId: 'session-1',
      scope,
      entryId: 'page-1',
    });
    expect(() => service.authenticate(grant.token, 'https://other.example.test')).toThrowError(
      expect.objectContaining({ code: 'preview_origin_denied' }),
    );
    const tampered = `${grant.token.slice(0, -1)}x`;
    expect(() => service.authenticate(tampered)).toThrowError(
      expect.objectContaining({ code: 'invalid_preview_token' }),
    );
    now = 131;
    expect(() => service.authenticate(grant.token)).toThrowError(
      expect.objectContaining({ code: 'preview_expired' }),
    );
  });

  it('denies unsafe targets and rejects message replay after authentication', () => {
    const service = new PreviewSessionService({
      signingSecret: 'preview-test-secret-with-at-least-32-characters',
      allowedOrigins: ['https://preview.example.test', 'http://localhost:4173'],
      now: () => 100,
      createId: () => 'session-2',
    });
    expect(() =>
      service.create({ scope, previewUrl: 'not a URL', route: '/', mode: 'standalone' }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_preview_url' }));
    expect(() =>
      service.create({
        scope,
        previewUrl: 'https://untrusted.example.test',
        route: '/',
        mode: 'iframe',
      }),
    ).toThrowError(expect.objectContaining({ code: 'preview_origin_denied' }));

    const grant = service.create({
      scope,
      previewUrl: 'http://localhost:4173/preview',
      route: '/',
      mode: 'standalone',
    });
    service.authenticate(grant.token, 'http://localhost:4173');
    expect(service.acceptMessage(grant.sessionId, 1, 'nonce-0000000001').sessionId).toBe(
      grant.sessionId,
    );
    expect(() => service.acceptMessage(grant.sessionId, 1, 'nonce-0000000002')).toThrowError(
      expect.objectContaining({ code: 'preview_replay' }),
    );
    expect(() => service.acceptMessage(grant.sessionId, 2, 'nonce-0000000001')).toThrowError(
      expect.objectContaining({ code: 'preview_replay' }),
    );
    expect(() => service.revoke(grant.sessionId, { ...scope, siteId: 'other-site' })).toThrowError(
      expect.objectContaining({ code: 'preview_scope_denied' }),
    );
    expect(service.authenticate(grant.token).sessionId).toBe(grant.sessionId);
    service.revoke(grant.sessionId, scope);
    expect(() => service.authenticate(grant.token)).toThrowError(
      expect.objectContaining({ code: 'preview_expired' }),
    );
  });
});
