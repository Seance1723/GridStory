import type { CustomerManagedKeyAdapter, CustomerManagedKeyDescription } from '@gridstory/core';
import { GridStoryError } from '@gridstory/core';
import type { CustomerManagedKeyReference } from '@gridstory/schema';

interface AwsKmsResponse {
  CiphertextBlob?: Uint8Array;
  Plaintext?: Uint8Array;
  KeyMetadata?: { Arn?: string; KeyId?: string; KeyState?: string };
}

export interface AwsKmsClient {
  describeKey(input: { KeyId: string }): Promise<AwsKmsResponse>;
  encrypt(input: {
    KeyId: string;
    Plaintext: Uint8Array;
    EncryptionContext: Record<string, string>;
  }): Promise<AwsKmsResponse>;
  decrypt(input: {
    KeyId: string;
    CiphertextBlob: Uint8Array;
    EncryptionContext: Record<string, string>;
  }): Promise<AwsKmsResponse>;
}

function awsRegion(keyId: string): string {
  const region = /^arn:[^:]+:kms:([^:]+):/.exec(keyId)?.[1];
  if (!region) throw new GridStoryError('AWS KMS key must be a regional ARN.', 'invalid_key', 400);
  return region;
}

export class AwsKmsCustomerManagedKeyAdapter implements CustomerManagedKeyAdapter {
  readonly name = 'aws-kms' as const;
  readonly #client: AwsKmsClient;

  constructor(client: AwsKmsClient) {
    this.#client = client;
  }

  async describe(input: {
    reference: CustomerManagedKeyReference;
  }): Promise<CustomerManagedKeyDescription> {
    const response = await this.#client.describeKey({ KeyId: input.reference.keyId });
    const metadata = response.KeyMetadata;
    if (!metadata?.KeyId) throw new Error('AWS KMS did not return key metadata.');
    const state =
      metadata.KeyState === 'Enabled'
        ? 'active'
        : metadata.KeyState === 'PendingDeletion'
          ? 'pending-deletion'
          : metadata.KeyState === 'Disabled'
            ? 'disabled'
            : 'unavailable';
    return {
      adapter: this.name,
      keyId: metadata.Arn ?? metadata.KeyId,
      region: awsRegion(metadata.Arn ?? input.reference.keyId),
      state,
    };
  }

  async wrap(input: {
    reference: CustomerManagedKeyReference;
    plaintextKey: Uint8Array;
    context: Record<string, string>;
  }): Promise<Uint8Array> {
    const result = await this.#client.encrypt({
      KeyId: input.reference.keyId,
      Plaintext: input.plaintextKey,
      EncryptionContext: input.context,
    });
    if (!result.CiphertextBlob) throw new Error('AWS KMS did not return wrapped key material.');
    return result.CiphertextBlob;
  }

  async unwrap(input: {
    reference: CustomerManagedKeyReference;
    wrappedKey: Uint8Array;
    context: Record<string, string>;
  }): Promise<Uint8Array> {
    const result = await this.#client.decrypt({
      KeyId: input.reference.keyId,
      CiphertextBlob: input.wrappedKey,
      EncryptionContext: input.context,
    });
    if (!result.Plaintext) throw new Error('AWS KMS did not return plaintext key material.');
    return result.Plaintext;
  }
}

interface GoogleKmsKey {
  name?: string;
  primary?: { name?: string; state?: string };
}
interface GoogleKmsCryptoResponse {
  ciphertext?: Uint8Array | string;
  plaintext?: Uint8Array | string;
}

export interface GoogleCloudKmsClient {
  getCryptoKey(input: { name: string }): Promise<[GoogleKmsKey]>;
  encrypt(input: {
    name: string;
    plaintext: Uint8Array;
    additionalAuthenticatedData: Uint8Array;
  }): Promise<[GoogleKmsCryptoResponse]>;
  decrypt(input: {
    name: string;
    ciphertext: Uint8Array;
    additionalAuthenticatedData: Uint8Array;
  }): Promise<[GoogleKmsCryptoResponse]>;
}

function bytes(value: Uint8Array | string | undefined, field: string): Uint8Array {
  if (value === undefined) throw new Error(`Google Cloud KMS did not return ${field}.`);
  return typeof value === 'string' ? Buffer.from(value, 'base64') : value;
}

function googleRegion(keyId: string): string {
  const region = /\/locations\/([^/]+)\//.exec(keyId)?.[1];
  if (!region)
    throw new GridStoryError('Google Cloud KMS key must include a location.', 'invalid_key', 400);
  return region;
}

export class GoogleCloudKmsCustomerManagedKeyAdapter implements CustomerManagedKeyAdapter {
  readonly name = 'google-cloud-kms' as const;
  readonly #client: GoogleCloudKmsClient;

  constructor(client: GoogleCloudKmsClient) {
    this.#client = client;
  }

  async describe(input: {
    reference: CustomerManagedKeyReference;
  }): Promise<CustomerManagedKeyDescription> {
    const [key] = await this.#client.getCryptoKey({ name: input.reference.keyId });
    const state =
      key.primary?.state === 'ENABLED'
        ? 'active'
        : key.primary?.state === 'DESTROY_SCHEDULED'
          ? 'pending-deletion'
          : key.primary?.state === 'DISABLED'
            ? 'disabled'
            : 'unavailable';
    return {
      adapter: this.name,
      keyId: key.name ?? input.reference.keyId,
      ...(key.primary?.name ? { keyVersion: key.primary.name } : {}),
      region: googleRegion(key.name ?? input.reference.keyId),
      state,
    };
  }

  async wrap(input: {
    reference: CustomerManagedKeyReference;
    plaintextKey: Uint8Array;
    context: Record<string, string>;
  }): Promise<Uint8Array> {
    const aad = Buffer.from(JSON.stringify(input.context));
    const [result] = await this.#client.encrypt({
      name: input.reference.keyId,
      plaintext: input.plaintextKey,
      additionalAuthenticatedData: aad,
    });
    return bytes(result.ciphertext, 'ciphertext');
  }

  async unwrap(input: {
    reference: CustomerManagedKeyReference;
    wrappedKey: Uint8Array;
    context: Record<string, string>;
  }): Promise<Uint8Array> {
    const aad = Buffer.from(JSON.stringify(input.context));
    const [result] = await this.#client.decrypt({
      name: input.reference.keyId,
      ciphertext: input.wrappedKey,
      additionalAuthenticatedData: aad,
    });
    return bytes(result.plaintext, 'plaintext');
  }
}
