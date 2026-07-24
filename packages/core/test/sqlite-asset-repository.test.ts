import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assetRecordSchema, type ContentScope } from '@gridstory/schema';
import { SqliteAssetRepository } from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};

describe('SqliteAssetRepository', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persists immutable asset records across repository instances and scopes reads', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gridstory-assets-'));
    directories.push(directory);
    const filename = join(directory, 'assets.db');
    const asset = assetRecordSchema.parse({
      ...scope,
      id: 'asset-1',
      kind: 'image',
      currentRevisionId: 'revision-1',
      revisions: [
        {
          id: 'revision-1',
          version: 1,
          original: {
            objectKey: 'assets/hero.jpg',
            url: 'https://cdn.example.test/assets/hero.jpg',
            filename: 'hero.jpg',
            mediaType: 'image/jpeg',
            size: 4,
            checksum: 'sha256:hero',
            width: 1600,
            height: 900,
          },
          metadata: { title: 'Hero', alt: 'Sunrise' },
          focalPoint: { x: 0.25, y: 0.75 },
          createdAt: '2026-07-24T00:00:00.000Z',
          actorId: 'author-a',
        },
      ],
      renditions: [],
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:00.000Z',
    });

    const writer = new SqliteAssetRepository({ filename });
    writer.save(asset);
    writer.close();

    const reader = new SqliteAssetRepository({ filename });
    expect(reader.get(scope, asset.id)).toEqual(asset);
    expect(reader.list(scope)).toEqual([asset]);
    expect(reader.get({ ...scope, tenantId: 'tenant-b' }, asset.id)).toBeNull();
    reader.close();
  });
});
