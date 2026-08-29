// @vitest-environment jsdom

import type {
  SchemaLifecycleInspection,
  SchemaMigrationAssessmentResponse,
  TaxonomyDefinition,
} from '@gridstory/client';
import {
  createSchemaIr,
  type ContentSchemaDefinition,
  type SchemaDriftReport,
} from '@gridstory/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchemaCatalog } from '../src/schema-catalog.js';

const schemas: ContentSchemaDefinition[] = [
  {
    id: 'page',
    version: 5,
    name: 'Page',
    description: 'Routed component page.',
    collection: 'pages',
    titleField: 'title',
    route: { pattern: '/:slug', slugField: 'slug' },
    localization: { localizedFields: ['title', 'slug'] },
    objects: [],
    taxonomies: [
      {
        id: 'topics',
        name: 'Topics',
        hierarchical: true,
        terms: [{ id: 'product', slug: 'product', label: 'Product' }],
      },
    ],
    fields: [
      {
        id: 'page.title',
        name: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        minLength: 1,
        maxLength: 120,
      },
      {
        id: 'page.slug',
        name: 'slug',
        label: 'Slug',
        type: 'slug',
        required: true,
      },
      {
        id: 'page.topics',
        name: 'topics',
        label: 'Topics',
        type: 'taxonomy',
        taxonomy: 'topics',
        multiple: true,
      },
    ],
  },
  {
    id: 'article',
    version: 1,
    name: 'Article',
    collection: 'articles',
    titleField: 'headline',
    route: { pattern: '/articles/:slug', slugField: 'slug' },
    fields: [
      {
        id: 'article.headline',
        name: 'headline',
        label: 'Headline',
        type: 'text',
        required: true,
        maxLength: 160,
      },
      {
        id: 'article.slug',
        name: 'slug',
        label: 'Slug',
        type: 'slug',
        required: true,
      },
    ],
  },
];

const source = createSchemaIr({ schemas, components: [] });
const lifecycle: SchemaLifecycleInspection = {
  source,
  visualModel: { format: 'gridstory.visual-model', modelVersion: 1, ir: source },
  fingerprint: 'a'.repeat(64),
  generatedTypes: 'export interface Page {}',
  generatedTypesFingerprint: 'b'.repeat(64),
  deployment: {
    document: source,
    fingerprint: 'a'.repeat(64),
    generatedTypes: 'export interface Page {}',
    generatedTypesFingerprint: 'b'.repeat(64),
    deployedAt: '2026-08-29T00:00:00.000Z',
    actorId: 'operator',
  },
};

const drift: SchemaDriftReport = {
  inSync: false,
  sourceFingerprint: lifecycle.fingerprint,
  expectedGeneratedTypesFingerprint: lifecycle.generatedTypesFingerprint,
  states: [
    {
      source: 'source',
      expectedFingerprint: lifecycle.fingerprint,
      actualFingerprint: lifecycle.fingerprint,
      status: 'match',
    },
    {
      source: 'deployed',
      expectedFingerprint: lifecycle.fingerprint,
      status: 'missing',
    },
  ],
};

const taxonomies: TaxonomyDefinition[] = [
  {
    id: 'topics',
    name: 'Topics',
    hierarchical: true,
    terms: [
      { id: 'product', slug: 'product', label: 'Product' },
      { id: 'launches', slug: 'launches', label: 'Launches', parentId: 'product' },
    ],
  },
  {
    id: 'article-topics',
    name: 'Article topics',
    hierarchical: false,
    terms: [{ id: 'product-news', slug: 'product-news', label: 'Product news' }],
  },
];

const impact: SchemaMigrationAssessmentResponse = {
  plan: {
    id: 'migration-current',
    fromFingerprint: lifecycle.fingerprint,
    toFingerprint: lifecycle.fingerprint,
    approval: { required: false, reasons: [] },
    estimate: { lock: 'none', dataScanRequired: false },
    rollback: { mode: 'automatic', reason: 'No changes.' },
    summary: { safe: 0, backfill: 0, destructive: 0 },
    steps: [],
  },
  impact: {
    scannedEntries: 7,
    affectedEntries: 0,
    byContentType: {},
    invalidEntries: [],
  },
};

afterEach(cleanup);

describe('Schema and taxonomy catalog', () => {
  it('inspects canonical model, route, field, drift, impact, and taxonomy identity without edit controls', () => {
    render(
      <SchemaCatalog
        schemas={schemas}
        lifecycle={lifecycle}
        drift={drift}
        impact={impact}
        taxonomies={taxonomies}
        loading={false}
        error={null}
        canReadTaxonomies
        canAssessImpact
        impactLoading={false}
        impactError={null}
        onRetry={vi.fn()}
      />,
    );

    const catalog = screen.getByRole('region', { name: 'Schema and taxonomy catalog' });
    expect(within(catalog).getByText('Code-owned · read-only')).toBeTruthy();
    expect(within(catalog).getByText('/:slug')).toBeTruthy();
    expect(within(catalog).getByText('text · required · min 1 chars · max 120 chars')).toBeTruthy();
    expect(within(catalog).getByText('Review drift')).toBeTruthy();
    expect(within(catalog).getByText('7')).toBeTruthy();
    expect(within(catalog).getByText('Hierarchical categories')).toBeTruthy();
    expect(within(catalog).getByText(/parent product/)).toBeTruthy();

    fireEvent.change(within(catalog).getByLabelText('Inspect model'), {
      target: { value: 'article' },
    });
    expect(within(catalog).getByText('/articles/:slug')).toBeTruthy();
    expect(within(catalog).getByText('headline · article.headline')).toBeTruthy();

    fireEvent.change(within(catalog).getByLabelText('Inspect taxonomy'), {
      target: { value: 'article-topics' },
    });
    expect(within(catalog).getByText('Flat tags')).toBeTruthy();
    expect(within(catalog).getByText('product-news')).toBeTruthy();
    expect(
      within(catalog).queryByRole('button', { name: /edit|save|deploy|activate/i }),
    ).toBeNull();
  });

  it('states permission boundaries and sends retry only for the base read error', () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <SchemaCatalog
        schemas={schemas}
        lifecycle={lifecycle}
        drift={drift}
        impact={null}
        taxonomies={[]}
        loading={false}
        error={null}
        canReadTaxonomies={false}
        canAssessImpact={false}
        impactLoading={false}
        impactError={null}
        onRetry={retry}
      />,
    );
    expect(screen.getByText(/No taxonomy request was sent/)).toBeTruthy();
    expect(screen.getByText(/does not request or imply deployment authority/)).toBeTruthy();

    rerender(
      <SchemaCatalog
        schemas={[]}
        lifecycle={null}
        drift={null}
        impact={null}
        taxonomies={[]}
        loading={false}
        error="Lifecycle unavailable"
        canReadTaxonomies={false}
        canAssessImpact={false}
        impactLoading={false}
        impactError={null}
        onRetry={retry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry schema catalog' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
