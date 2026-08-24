import { describe, expect, it } from 'vitest';
import {
  contentFederationDocumentSchema,
  federationOfferInputSchema,
  federationTypeDescriptorSchema,
  signedFederationEnvelopeSchema,
} from '../src/index.js';

const scope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

const pageSchema = {
  id: 'page',
  version: 1,
  name: 'Page',
  description: '',
  collection: 'pages',
  titleField: 'title',
  fields: [
    { id: 'page.title', name: 'title', label: 'Title', type: 'text' as const, required: true },
  ],
};

describe('content federation contracts', () => {
  it('keeps the complete-scope document bounded and strict', () => {
    const document = {
      ...scope,
      schemaVersion: 1 as const,
      version: 0,
      offers: [],
      agreements: [],
      mirrors: [],
      plans: [],
      receipts: [],
      updatedBy: 'system',
      updatedAt: '2026-08-24T10:00:00.000Z',
    };
    expect(contentFederationDocumentSchema.parse(document)).toEqual(document);
    expect(() =>
      contentFederationDocumentSchema.parse({ ...document, credential: 'secret' }),
    ).toThrow();
  });

  it('accepts supported external schemas and rejects code-bearing dependency fields', () => {
    const descriptor = {
      namespace: 'offer-a:page',
      contentType: 'page',
      version: 1,
      fingerprint: 'a'.repeat(64),
      schema: pageSchema,
    };
    expect(federationTypeDescriptorSchema.parse(descriptor)).toMatchObject(descriptor);
    expect(() =>
      federationTypeDescriptorSchema.parse({
        ...descriptor,
        schema: {
          ...pageSchema,
          fields: [
            {
              id: 'page.hero',
              name: 'hero',
              label: 'Hero',
              type: 'component-tree',
              required: true,
            },
          ],
          titleField: 'hero',
        },
      }),
    ).toThrow(/unsupported component-tree/u);
  });

  it('requires credential-free HTTPS offer configuration and strict signed envelopes', () => {
    const offer = {
      expectedVersion: 0,
      id: 'offer-a',
      state: 'enabled' as const,
      sourceInstance: 'https://source.example.test/',
      canonicalBaseUrl: 'https://source.example.test/content/',
      contentTypes: [{ id: 'page', version: 1 }],
      attribution: {
        licenseUrl: 'https://source.example.test/license',
        creditText: 'Provided by Source A',
        attributedTo: [{ name: 'Source A', url: 'https://source.example.test/' }],
      },
    };
    expect(federationOfferInputSchema.parse(offer)).toEqual(offer);
    expect(() =>
      federationOfferInputSchema.parse({
        ...offer,
        sourceInstance: 'https://token:secret@source.example.test/',
      }),
    ).toThrow();
    expect(() =>
      signedFederationEnvelopeSchema.parse({ payload: {}, signature: {}, rawToken: 'secret' }),
    ).toThrow();
  });
});
