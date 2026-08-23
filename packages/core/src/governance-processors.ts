import { randomUUID } from 'node:crypto';
import type { ContentScope, GovernanceResourceTarget } from '@gridstory/schema';
import type { AssetService } from './asset-service.js';
import type { EnterpriseIdentityService } from './enterprise-identity-service.js';
import { GridStoryError } from './errors.js';
import type {
  GovernanceResourceInspection,
  GovernedResourceProcessor,
} from './governance-service.js';
import type { CacheInvalidator } from './operations-service.js';
import { contentEventCacheTags } from './tenant-scope.js';
import type { ContentRepository } from './types.js';

export class ContentGovernanceProcessor implements GovernedResourceProcessor {
  readonly type = 'content' as const;
  readonly name = 'gridstory-content';
  readonly #repository: ContentRepository;
  readonly #cacheInvalidator: CacheInvalidator;
  readonly #createId: () => string;
  readonly #now: () => string;

  constructor(input: {
    repository: ContentRepository;
    cacheInvalidator?: CacheInvalidator;
    createId?: () => string;
    now?: () => string;
  }) {
    this.#repository = input.repository;
    this.#cacheInvalidator = input.cacheInvalidator ?? (async () => undefined);
    this.#createId = input.createId ?? randomUUID;
    this.#now = input.now ?? (() => new Date().toISOString());
  }

  async inspect(input: {
    scope: ContentScope;
    resource: GovernanceResourceTarget;
  }): Promise<GovernanceResourceInspection> {
    const entry = await this.#repository.getById({
      scope: input.scope,
      id: input.resource.id,
      perspective: 'draft',
    });
    return entry
      ? {
          exists: true,
          version: entry.draftRevisionId,
          updatedAt: entry.updatedAt,
          effect: `delete content aggregate ${entry.id} and its revisions/audit`,
        }
      : { exists: false, effect: 'content aggregate is absent' };
  }

  async export(input: {
    scope: ContentScope;
    resource: GovernanceResourceTarget;
  }): Promise<unknown> {
    const records = await this.#repository.exportPortableContent({ scope: input.scope });
    return records.find((record) => record.entryId === input.resource.id) ?? null;
  }

  async erase(input: {
    scope: ContentScope;
    resource: GovernanceResourceTarget;
  }): Promise<{ effect: string }> {
    const entry = await this.#repository.getById({
      scope: input.scope,
      id: input.resource.id,
      perspective: 'draft',
    });
    if (!entry) return { effect: 'content_already_absent' };
    const tags = new Set(
      contentEventCacheTags(input.scope, entry.contentType, entry.id, entry.draftRevisionId),
    );
    if (entry.publishedRevisionId) {
      for (const tag of contentEventCacheTags(
        input.scope,
        entry.contentType,
        entry.id,
        entry.publishedRevisionId,
      )) {
        tags.add(tag);
      }
    }
    await this.#cacheInvalidator({ scope: input.scope, tags: [...tags] });
    await this.#repository.enqueueJob({
      scope: input.scope,
      type: 'search.rebuild',
      idempotencyKey: `governance:content-erasure:${entry.id}:${this.#createId()}`,
      payload: { perspective: 'published', reason: 'governance_erasure' },
      runAt: this.#now(),
      maxAttempts: 5,
    });
    if (!(await this.#repository.deleteEntry({ scope: input.scope, id: entry.id }))) {
      throw new GridStoryError(
        'Content changed during governed erasure.',
        'governance_resource_changed',
        409,
      );
    }
    return { effect: 'content_aggregate_erased_and_cache_invalidated' };
  }
}

export class AssetGovernanceProcessor implements GovernedResourceProcessor {
  readonly type = 'asset' as const;
  readonly name = 'gridstory-asset';
  readonly #assets: AssetService;

  constructor(assets: AssetService) {
    this.#assets = assets;
  }

  async inspect(input: {
    scope: ContentScope;
    resource: GovernanceResourceTarget;
  }): Promise<GovernanceResourceInspection> {
    try {
      const asset = await this.#assets.get(input.scope, input.resource.id);
      return {
        exists: true,
        version: asset.currentRevisionId,
        updatedAt: asset.updatedAt,
        effect: `delete asset metadata and ${asset.revisions.length + asset.renditions.length} stored objects`,
      };
    } catch (error) {
      if (error instanceof GridStoryError && error.code === 'not_found') {
        return { exists: false, effect: 'asset is absent' };
      }
      throw error;
    }
  }

  async export(input: {
    scope: ContentScope;
    resource: GovernanceResourceTarget;
  }): Promise<unknown> {
    try {
      return await this.#assets.get(input.scope, input.resource.id);
    } catch (error) {
      if (error instanceof GridStoryError && error.code === 'not_found') return null;
      throw error;
    }
  }

  erase(input: {
    scope: ContentScope;
    resource: GovernanceResourceTarget;
  }): Promise<{ effect: string }> {
    return this.#assets.erase(input.scope, input.resource.id);
  }
}

export class IdentityGovernanceProcessor implements GovernedResourceProcessor {
  readonly type = 'identity' as const;
  readonly name = 'gridstory-identity';
  readonly #identity: EnterpriseIdentityService;

  constructor(identity: EnterpriseIdentityService) {
    this.#identity = identity;
  }

  async inspect(input: {
    scope: ContentScope;
    resource: GovernanceResourceTarget;
  }): Promise<GovernanceResourceInspection> {
    const snapshot = await this.#identity.snapshot({
      organizationId: input.scope.organizationId,
      tenantId: input.scope.tenantId,
    });
    const user = snapshot.users.find((candidate) => candidate.id === input.resource.id);
    return user
      ? {
          exists: true,
          version: String(user.version),
          updatedAt: user.updatedAt,
          effect: 'revoke identity access and anonymize direct directory identifiers',
        }
      : { exists: false, effect: 'directory identity is absent' };
  }

  async export(input: {
    scope: ContentScope;
    resource: GovernanceResourceTarget;
  }): Promise<unknown> {
    const snapshot = await this.#identity.snapshot({
      organizationId: input.scope.organizationId,
      tenantId: input.scope.tenantId,
    });
    return snapshot.users.find((candidate) => candidate.id === input.resource.id) ?? null;
  }

  async erase(input: {
    scope: ContentScope;
    resource: GovernanceResourceTarget;
    actorId: string;
  }): Promise<{ effect: string }> {
    const user = await this.#identity.anonymizeUser(
      { organizationId: input.scope.organizationId, tenantId: input.scope.tenantId },
      input.actorId,
      input.resource.id,
    );
    return { effect: `identity_anonymized:v${user.version}` };
  }
}
