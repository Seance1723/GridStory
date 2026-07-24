import { describe, expect, it } from 'vitest';
import { AssetDeliveryService } from '../src/index.js';

const scope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

describe('AssetDeliveryService', () => {
  it('signs short-lived grants bound to the full scope, asset, and revision', () => {
    let now = new Date('2026-07-24T00:00:00.000Z');
    const service = new AssetDeliveryService({
      signingSecret: 'asset-delivery-test-secret-with-32-characters',
      now: () => now,
    });
    const grant = service.create({
      scope,
      assetId: 'asset-a',
      revisionId: 'revision-a',
      ttlSeconds: 60,
    });
    const token = new URL(grant.url, 'https://gridstory.test').searchParams.get('token');
    expect(token).toBeTruthy();
    expect(service.authenticate(token ?? '', 'asset-a')).toMatchObject({
      ...scope,
      assetId: 'asset-a',
      revisionId: 'revision-a',
    });
    expect(() => service.authenticate(token ?? '', 'asset-b')).toThrowError(
      expect.objectContaining({ code: 'invalid_asset_delivery_token', statusCode: 401 }),
    );

    const tampered = `${token?.slice(0, -1)}x`;
    expect(() => service.authenticate(tampered, 'asset-a')).toThrowError(
      expect.objectContaining({ code: 'invalid_asset_delivery_token', statusCode: 401 }),
    );

    now = new Date('2026-07-24T00:01:00.000Z');
    expect(() => service.authenticate(token ?? '', 'asset-a')).toThrowError(
      expect.objectContaining({ code: 'asset_delivery_token_expired', statusCode: 401 }),
    );
  });

  it('enforces signing-secret and grant-lifetime bounds', () => {
    expect(() => new AssetDeliveryService({ signingSecret: 'short' })).toThrow(
      'at least 32 characters',
    );
    const service = new AssetDeliveryService({
      signingSecret: 'asset-delivery-test-secret-with-32-characters',
    });
    expect(() =>
      service.create({ scope, assetId: 'asset-a', revisionId: 'revision-a', ttlSeconds: 10 }),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid_asset_delivery_ttl', statusCode: 400 }),
    );
  });
});
