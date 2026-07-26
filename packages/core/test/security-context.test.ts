import { describe, expect, it } from 'vitest';
import type { Principal } from '@gridstory/schema';
import {
  AuthorizationPolicy,
  GridStoryActions,
  InvalidScopeError,
  ScopeRegistry,
  createLocalTopology,
} from '../src/index.js';

const viewer: Principal = {
  id: 'viewer-1',
  type: 'user',
  roles: ['viewer'],
  roleAssignments: [{ roleId: 'viewer', tenantId: 'default' }],
  authenticationMethod: 'oidc',
};

function context(principal: Principal = viewer) {
  return new ScopeRegistry(createLocalTopology()).resolve({
    organizationId: 'local',
    tenantId: 'default',
    workspaceId: 'default',
    siteId: 'default',
    environmentId: 'development',
    locale: 'en',
    perspective: 'draft',
    principal,
  });
}

describe('request context and authorization', () => {
  it('resolves only internally consistent active hierarchy and locale scope', () => {
    expect(context().siteId).toBe('default');
    expect(() =>
      new ScopeRegistry(createLocalTopology()).resolve({
        ...context(),
        environmentId: 'missing',
      }),
    ).toThrow(InvalidScopeError);
  });

  it('applies role permissions and denies unmatched actions by default', () => {
    const policy = new AuthorizationPolicy();
    expect(
      policy.decide(context(), GridStoryActions.contentRead, {
        kind: 'content',
        contentType: 'page',
      }).allowed,
    ).toBe(true);
    expect(
      policy.decide(context(), GridStoryActions.contentCreate, {
        kind: 'content',
        contentType: 'page',
      }).allowed,
    ).toBe(false);
    expect(
      policy.decide({ ...context(), tenantId: 'neighbor' }, GridStoryActions.contentRead, {
        kind: 'content',
        contentType: 'page',
      }).allowed,
    ).toBe(false);
  });

  it('limits direct service-account grants by tenant, site, environment, locale, and type', () => {
    const principal: Principal = {
      id: 'build-bot',
      type: 'service-account',
      roles: [],
      authenticationMethod: 'service-token',
      grants: [
        {
          actions: [GridStoryActions.contentPublish],
          tenantId: 'default',
          siteId: 'default',
          environmentIds: ['development'],
          locales: ['en'],
          contentTypes: ['page'],
        },
      ],
    };
    const policy = new AuthorizationPolicy();
    expect(
      policy.decide(context(principal), GridStoryActions.contentPublish, {
        kind: 'content',
        contentType: 'page',
      }).allowed,
    ).toBe(true);
    expect(
      policy.decide(context(principal), GridStoryActions.contentPublish, {
        kind: 'content',
        contentType: 'article',
      }).allowed,
    ).toBe(false);
  });
});
