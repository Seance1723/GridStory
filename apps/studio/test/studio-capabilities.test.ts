import { readFileSync } from 'node:fs';
import { createGridStoryClient, GridStoryApiError } from '@gridstory/client';
import { type StudioCapabilities, studioDestinations, studioOperations } from '@gridstory/schema';
import { describe, expect, it, vi } from 'vitest';
import {
  guardStudioClient,
  studioClientOperations,
  studioMethodOperations,
} from '../src/studio-capabilities.js';

function capabilities(allowed: boolean): StudioCapabilities {
  return {
    screens: Object.fromEntries(studioDestinations.map((id) => [id, allowed])),
    operations: Object.fromEntries(studioOperations.map((id) => [id, allowed])),
  } as StudioCapabilities;
}

describe('finite Studio invocation guard', () => {
  it('maps every feature client call in App explicitly, without fallback methods', () => {
    const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const used = [...source.matchAll(/\bclient\.(\w+)\(/g)].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(100);
    for (const name of used) expect(studioMethodOperations).toHaveProperty(name);
  });

  it.each(Object.entries(studioMethodOperations))(
    'gates %s before invocation and preserves allowed arguments',
    async (name, operations) => {
      const client = createGridStoryClient({ baseUrl: 'http://unit.test', tenantId: 'default' });
      const method = vi.fn().mockResolvedValue('authorized result');
      Object.defineProperty(client, name, { value: method, configurable: true, writable: true });
      const permissions = capabilities(true);
      const guarded = guardStudioClient(
        client,
        () => ({ capabilities: permissions, generation: 1 }),
        vi.fn(),
      );
      for (const operation of operations) {
        permissions.operations[operation] = false;
        await expect(
          Reflect.apply(Reflect.get(guarded, name), guarded, ['id', { value: 'draft' }]),
        ).rejects.toMatchObject({ status: 403 });
        expect(method).not.toHaveBeenCalled();
        permissions.operations[operation] = true;
      }
      await expect(
        Reflect.apply(Reflect.get(guarded, name), guarded, ['id', { value: 'draft' }]),
      ).resolves.toBe('authorized result');
      expect(method).toHaveBeenCalledExactlyOnceWith('id', { value: 'draft' });
    },
  );

  it('matches exact route actions for non-obvious operations (BUG-0444)', () => {
    expect(studioMethodOperations.getSearchIndexStatus).toEqual(['search.read']);
    expect(studioMethodOperations.inspectFederationAgreement).toEqual(['federation.manage']);
    expect(studioMethodOperations.setFederationAgreementState).toEqual(['federation.manage']);
    expect(studioMethodOperations.approveGovernancePlan).toEqual(['governance.execute']);
    expect(studioMethodOperations.validateMigrationCutover).toEqual(['migration.execute']);
    expect(studioMethodOperations.installMarketplaceRelease).toEqual([
      'marketplace.read',
      'plugin.manage',
    ]);
  });

  it('keeps page-specific and generic collection list/create checks distinct', () => {
    expect(studioClientOperations('listContent', [{ contentType: 'page' }])).toEqual([
      'pages.list',
    ]);
    expect(studioClientOperations('createContent', ['page', {}])).toEqual(['pages.create']);
    expect(studioClientOperations('listContent', [{ contentType: 'article' }])).toEqual([
      'content.read',
    ]);
    expect(studioClientOperations('createContent', ['article', {}])).toEqual(['content.create']);
  });

  it('does not expose legacy context or raw scoped transport through the feature adapter', async () => {
    const client = createGridStoryClient({ baseUrl: 'http://unit.test', tenantId: 'default' });
    const legacy = vi.spyOn(client, 'getRequestContext');
    const guarded = guardStudioClient(
      client,
      () => ({ capabilities: capabilities(true), generation: 1 }),
      vi.fn(),
    );
    await expect(guarded.getRequestContext()).rejects.toMatchObject({ status: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each([200, 401, 403])(
    'discards a stale %s result without affecting the new authority',
    async (status) => {
      let resolve!: (value: unknown) => void;
      let reject!: (reason: unknown) => void;
      const client = createGridStoryClient({ baseUrl: 'http://unit.test', tenantId: 'default' });
      vi.spyOn(client, 'listAssets').mockImplementation(
        () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      );
      let generation = 1;
      const denied = vi.fn();
      const guarded = guardStudioClient(
        client,
        () => ({ capabilities: capabilities(true), generation }),
        denied,
      );
      const result = guarded.listAssets();
      generation += 1;
      if (status === 200) resolve([]);
      else reject(new GridStoryApiError('old authority', { status }));
      await expect(result).rejects.toMatchObject({ name: 'AbortError' });
      expect(denied).not.toHaveBeenCalled();
    },
  );

  it('revokes a preview grant that arrives after its authority is suspended', async () => {
    const client = createGridStoryClient({ baseUrl: 'http://unit.test', tenantId: 'default' });
    const pending = Promise.withResolvers<unknown>();
    vi.spyOn(client, 'createPreviewSession').mockReturnValue(
      pending.promise as ReturnType<typeof client.createPreviewSession>,
    );
    const revoke = vi.spyOn(client, 'revokePreviewSession').mockResolvedValue(undefined);
    let generation = 1;
    const guarded = guardStudioClient(
      client,
      () => ({ capabilities: capabilities(true), generation }),
      vi.fn(),
    );
    const result = guarded.createPreviewSession({
      previewUrl: 'http://preview.test',
      route: '/',
      mode: 'standalone',
      entryId: 'one',
    });
    generation += 1;
    pending.resolve({ sessionId: 'obsolete-preview-grant' });
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(revoke).toHaveBeenCalledExactlyOnceWith('obsolete-preview-grant');
  });

  it.each([401, 403] as const)(
    'invalidates observed current %s before returning to a feature',
    async (status) => {
      const client = createGridStoryClient({ baseUrl: 'http://unit.test', tenantId: 'default' });
      vi.spyOn(client, 'listAssets').mockRejectedValue(
        new GridStoryApiError('private detail', { status }),
      );
      const denied = vi.fn();
      const guarded = guardStudioClient(
        client,
        () => ({ capabilities: capabilities(true), generation: 1 }),
        denied,
      );
      await expect(guarded.listAssets()).rejects.toMatchObject({ name: 'AbortError' });
      expect(denied).toHaveBeenCalledExactlyOnceWith(status);
    },
  );
});
