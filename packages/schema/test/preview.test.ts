import { describe, expect, it } from 'vitest';
import {
  PREVIEW_PROTOCOL_VERSION,
  previewMessageSchema,
  previewSessionClaimsSchema,
} from '../src/index.js';

describe('preview protocol contracts', () => {
  it('parses scope-bound session claims and typed patch/selection messages', () => {
    const claims = previewSessionClaimsSchema.parse({
      audience: 'gridstory-preview',
      protocolVersion: PREVIEW_PROTOCOL_VERSION,
      sessionId: 'session-1',
      scope: {
        organizationId: 'acme',
        tenantId: 'tenant',
        workspaceId: 'marketing',
        siteId: 'website',
        environmentId: 'preview',
        locale: 'en',
      },
      origin: 'https://preview.example.test',
      route: '/welcome',
      mode: 'iframe',
      issuedAt: 100,
      expiresAt: 200,
    });
    const patch = previewMessageSchema.parse({
      protocolVersion: 1,
      sessionId: claims.sessionId,
      sequence: 1,
      nonce: 'nonce-0000000001',
      type: 'gridstory.preview.patch',
      payload: { entryId: 'page-1', contentType: 'page', data: { title: 'Unsaved' } },
    });

    expect(claims.scope.siteId).toBe('website');
    expect(patch.type).toBe('gridstory.preview.patch');
    expect(previewMessageSchema.safeParse({ ...patch, sequence: -1 }).success).toBe(false);
  });
});
