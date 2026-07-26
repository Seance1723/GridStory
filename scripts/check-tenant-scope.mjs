import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const coreSource = join(root, 'packages', 'core', 'src');
const failures = [];

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

const requiredTokens = new Map([
  [
    'packages/core/src/tenant-scope.ts',
    [
      'organizationId',
      'tenantId',
      'workspaceId',
      'siteId',
      'environmentId',
      'locale',
      'assertSameContentScope',
      'contentScopeCachePrefix',
      'TenantTelemetryEvent extends ContentScope',
    ],
  ],
  [
    'apps/api/src/request-context.ts',
    ['assertValidContentScope', 'const scope = assertValidContentScope({'],
  ],
  [
    'packages/core/src/operations-service.ts',
    [
      'export interface WebhookTransportInput',
      'scope: ContentScope;',
      'export type CacheInvalidator = (input:',
      'cacheTagBelongsToScope(scope, tag)',
      "assertSameContentScope(input.scope, event, 'claimed outbox batch')",
      "assertSameContentScope(input.scope, job, 'claimed job batch')",
    ],
  ],
  [
    'packages/core/src/search-service.ts',
    [
      'export interface SearchAdapterResult',
      'scope: ContentScope;',
      'perspective: ContentPerspective;',
      "assertSameContentScope(scope, result.scope, 'search adapter result')",
      'facets: safeAdapterFacets(hits, this.#taxonomies)',
      'total: hits.length',
    ],
  ],
  [
    'packages/core/src/asset-service.ts',
    ["assertSameContentScope(scope, asset, 'asset repository list')"],
  ],
  [
    'packages/core/src/audit-service.ts',
    ['contentScopeKey(event)', 'event.entryId', 'assertSameContentScope(scope, event'],
  ],
  ['packages/core/src/sqlite-repository.ts', ['contentEventCacheTags']],
  ['packages/core/src/postgres-repository.ts', ['contentEventCacheTags']],
  [
    'packages/core/src/identity.ts',
    [
      'roleAssignments: roles.map((roleId) => ({ roleId, tenantId }))',
      'grant.tenantId !== input.tenantId',
    ],
  ],
  [
    'packages/core/test/tenant-isolation.test.ts',
    [
      'collision-safe keys, paths, and cache prefixes',
      'rejects foreign claimed outbox events and durable jobs',
      'does not expose adapter-provided totals or facets',
    ],
  ],
]);

for (const [relativePath, tokens] of requiredTokens) {
  const source = await readFile(join(root, relativePath), 'utf8');
  for (const token of tokens) {
    if (!source.includes(token)) failures.push(`${relativePath}: missing contract token ${token}`);
  }
}

for (const file of await sourceFiles(coreSource)) {
  const source = await readFile(file, 'utf8');
  const name = relative(root, file).replaceAll('\\', '/');
  if (/\b(?:function|const)\s+(?:scopeKey|serializedScope)\b/.test(source)) {
    failures.push(`${name}: defines an ad hoc tenant-scope serializer`);
  }
  if (/gridstory:(?:tenant|site|environment|locale|type|entry|revision):/.test(source)) {
    failures.push(`${name}: contains a cache tag without the canonical full-scope prefix`);
  }
}

if (failures.length > 0) {
  console.error('GridStory tenant-scope contract violations:\n');
  failures.forEach((failure) => {
    console.error(`- ${failure}`);
  });
  process.exitCode = 1;
} else {
  console.log('GridStory tenant-scope contracts are valid.');
}
