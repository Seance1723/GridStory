import { describe, expect, it } from 'vitest';
import {
  componentManifestSchema,
  createInteroperabilityDiscovery,
  createInteroperabilitySpecifications,
  createPreviewSourceMap,
  interoperabilityDiscoverySchema,
  interoperabilityExamples,
  logicalArchiveSchema,
  previewSourceMapSchema,
  schemaIrDocumentSchema,
} from '../src/index.js';

describe('public interoperability contracts', () => {
  it('generates four stable Draft 2020-12 specifications and a minimized descriptor', () => {
    const specifications = createInteroperabilitySpecifications();
    expect(specifications.map((item) => item.kind)).toEqual([
      'logical-content-archive',
      'content-schema-ir',
      'component-manifest',
      'preview-source-map',
    ]);
    for (const specification of specifications) {
      expect(specification.schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(specification.schema.$id).toBe(specification.id);
      expect(specification.digest).toMatch(/^[a-f0-9]{64}$/u);
    }
    const discovery = createInteroperabilityDiscovery({
      instanceId: 'instance-primary',
      serviceVersion: '8.4.0',
    });
    expect(interoperabilityDiscoverySchema.parse(discovery)).toEqual(discovery);
    expect(JSON.stringify(discovery)).not.toMatch(
      /"(?:organizationId|tenantId|workspaceId|siteId|environmentId|locale|credential|token|draftRevisionId)"/u,
    );
  });

  it('keeps committed examples valid against their canonical input contracts', () => {
    expect(
      logicalArchiveSchema.safeParse(interoperabilityExamples['logical-content-archive']).success,
    ).toBe(true);
    expect(
      schemaIrDocumentSchema.safeParse(interoperabilityExamples['content-schema-ir']).success,
    ).toBe(true);
    expect(
      componentManifestSchema.safeParse(interoperabilityExamples['component-manifest']).success,
    ).toBe(true);
    expect(
      previewSourceMapSchema.safeParse(interoperabilityExamples['preview-source-map']).success,
    ).toBe(true);
  });

  it('maps recursive component nodes to existing preview-only node selectors', () => {
    const sourceMap = createPreviewSourceMap({
      entryId: 'entry-1',
      contentType: 'page',
      revisionId: 'revision-2',
      nodes: [
        {
          id: 'parent',
          component: 'layout',
          version: 2,
          props: {},
          slots: {
            main: [{ id: 'child', component: 'hero', version: 1, props: {} }],
          },
        },
      ],
    });
    expect(sourceMap.mappings).toEqual([
      {
        nodeId: 'parent',
        componentId: 'layout',
        componentVersion: 2,
        selector: { attribute: 'data-gridstory-node', value: 'parent' },
      },
      {
        nodeId: 'child',
        componentId: 'hero',
        componentVersion: 1,
        selector: { attribute: 'data-gridstory-node', value: 'child' },
      },
    ]);
    expect(() =>
      createPreviewSourceMap({
        entryId: 'entry-1',
        contentType: 'page',
        nodes: [
          { id: 'same', component: 'hero', version: 1, props: {} },
          { id: 'same', component: 'copy', version: 1, props: {} },
        ],
      }),
    ).toThrow(/duplicated/u);
  });
});
