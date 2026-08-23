import type { ContentScope, CustomerManagedKeyReference } from '@gridstory/schema';
import { describe, expect, it, vi } from 'vitest';
import {
  AwsKmsCustomerManagedKeyAdapter,
  GoogleCloudKmsCustomerManagedKeyAdapter,
} from '../src/governance-adapters.js';

const scope: ContentScope = {
  organizationId: 'org',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  siteId: 'site',
  environmentId: 'production',
  locale: 'en',
};

describe('customer-managed key adapters', () => {
  it('binds AWS KMS wrapping to the exact tenant context and regional ARN', async () => {
    const encrypt = vi.fn(async () => ({ CiphertextBlob: Uint8Array.of(4, 5, 6) }));
    const decrypt = vi.fn(async () => ({ Plaintext: Uint8Array.of(1, 2, 3) }));
    const adapter = new AwsKmsCustomerManagedKeyAdapter({
      describeKey: async () => ({
        KeyMetadata: {
          KeyId: 'key-1',
          Arn: 'arn:aws:kms:eu-west-1:123456789012:key/key-1',
          KeyState: 'Enabled',
        },
      }),
      encrypt,
      decrypt,
    });
    const reference: CustomerManagedKeyReference = {
      adapter: 'aws-kms',
      keyId: 'arn:aws:kms:eu-west-1:123456789012:key/key-1',
      expectedRegion: 'eu-west-1',
      updatedBy: 'admin',
      updatedAt: '2026-08-23T00:00:00.000Z',
    };
    const context = { tenantId: scope.tenantId, requestId: 'request-1' };

    await expect(adapter.describe({ scope, reference })).resolves.toMatchObject({
      adapter: 'aws-kms',
      region: 'eu-west-1',
      state: 'active',
    });
    await expect(
      adapter.wrap({ scope, reference, plaintextKey: Uint8Array.of(1, 2, 3), context }),
    ).resolves.toEqual(Uint8Array.of(4, 5, 6));
    await expect(
      adapter.unwrap({ scope, reference, wrappedKey: Uint8Array.of(4, 5, 6), context }),
    ).resolves.toEqual(Uint8Array.of(1, 2, 3));
    expect(encrypt).toHaveBeenCalledWith(expect.objectContaining({ EncryptionContext: context }));
    expect(decrypt).toHaveBeenCalledWith(expect.objectContaining({ EncryptionContext: context }));
  });

  it('binds Google Cloud KMS wrapping to AAD and the configured key location', async () => {
    const encrypt = vi.fn(async () => [{ ciphertext: Uint8Array.of(8, 9) }] as const);
    const decrypt = vi.fn(async () => [{ plaintext: Uint8Array.of(2, 1) }] as const);
    const keyId = 'projects/acme/locations/europe-west1/keyRings/gridstory/cryptoKeys/export';
    const adapter = new GoogleCloudKmsCustomerManagedKeyAdapter({
      getCryptoKey: async () => [
        { name: keyId, primary: { name: `${keyId}/cryptoKeyVersions/7`, state: 'ENABLED' } },
      ],
      encrypt,
      decrypt,
    });
    const reference: CustomerManagedKeyReference = {
      adapter: 'google-cloud-kms',
      keyId,
      expectedRegion: 'europe-west1',
      updatedBy: 'admin',
      updatedAt: '2026-08-23T00:00:00.000Z',
    };
    const context = { organizationId: scope.organizationId, requestId: 'request-2' };

    await expect(adapter.describe({ scope, reference })).resolves.toMatchObject({
      adapter: 'google-cloud-kms',
      region: 'europe-west1',
      state: 'active',
      keyVersion: `${keyId}/cryptoKeyVersions/7`,
    });
    await expect(
      adapter.wrap({ scope, reference, plaintextKey: Uint8Array.of(2, 1), context }),
    ).resolves.toEqual(Uint8Array.of(8, 9));
    await expect(
      adapter.unwrap({ scope, reference, wrappedKey: Uint8Array.of(8, 9), context }),
    ).resolves.toEqual(Uint8Array.of(2, 1));
    expect(
      Buffer.from(encrypt.mock.calls[0]?.[0].additionalAuthenticatedData ?? []).toString(),
    ).toBe(JSON.stringify(context));
  });
});
