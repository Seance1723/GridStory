import { describe, expect, it } from 'vitest';
import {
  studioContextSchema,
  studioDestinations,
  studioOperations,
  studioScopeSelectionSchema,
  studioTopologySchema,
} from '../src/index.js';

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Required fixture value is missing.');
  return value;
}

const scope = {
  organizationId: 'org',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  siteId: 'site',
  environmentId: 'dev',
  locale: 'en',
};
const response = () => ({
  version: 1,
  scope,
  principalId: 'caller',
  capabilities: {
    screens: Object.fromEntries(studioDestinations.map((key) => [key, false])),
    operations: Object.fromEntries(studioOperations.map((key) => [key, false])),
  },
  selection: { mode: 'current-only', choices: [] as unknown[] },
});
const topology = () => ({
  organizations: [{ id: 'org', name: 'Org', status: 'active' }],
  tenants: [{ id: 'tenant', name: 'Tenant', organizationId: 'org', status: 'active' }],
  workspaces: [{ id: 'workspace', name: 'Workspace', tenantId: 'tenant', status: 'active' }],
  sites: [{ id: 'site', name: 'Site', workspaceId: 'workspace', status: 'active' }],
  environments: [
    { id: 'dev', name: 'Development', siteId: 'site', kind: 'development', status: 'active' },
  ],
  locales: [{ siteId: 'site', code: 'en', label: 'English', default: true, enabled: true }],
});

describe('minimized Studio contracts', () => {
  it('has exactly the finite destinations and explicit boolean operations', () => {
    expect(studioDestinations).toHaveLength(22);
    expect(new Set(studioOperations).size).toBe(studioOperations.length);
    expect(studioContextSchema.parse(response()).capabilities.screens.pages).toBe(false);
    expect(studioContextSchema.parse(response()).capabilities.screens.home).toBe(false);
    expect(studioContextSchema.parse(response()).capabilities.screens.schemas).toBe(false);
    for (const change of [
      { version: 2 },
      { principal: { roles: ['admin'] } },
      { topology: topology() },
      { capabilities: { screens: {}, operations: {} } },
    ])
      expect(studioContextSchema.safeParse({ ...response(), ...change }).success).toBe(false);
    const unknown = response();
    unknown.capabilities.operations.alien = true;
    expect(studioContextSchema.safeParse(unknown).success).toBe(false);
  });

  it('rejects scope substitution, duplicate and oversized choices', () => {
    const choice = {
      scope,
      labels: { site: 'Site', environment: 'Development', locale: 'English' },
    };
    const value = response();
    value.selection.choices = [choice];
    expect(studioContextSchema.safeParse(value).success).toBe(true);
    value.selection.choices = [choice, choice];
    expect(studioContextSchema.safeParse(value).success).toBe(false);
    for (const field of [
      'organizationId',
      'tenantId',
      'workspaceId',
      'siteId',
      'environmentId',
      'locale',
    ]) {
      value.selection.choices = [{ ...choice, scope: { ...scope, [field]: 'other' } }];
      expect(studioContextSchema.safeParse(value).success, field).toBe(false);
    }
    value.selection.choices = Array.from({ length: 257 }, () => choice);
    expect(studioContextSchema.safeParse(value).success).toBe(false);
  });

  it('limits clone input to valid site/environment/locale identifiers', () => {
    const selection = { siteId: 'site', environmentId: 'prod', locale: 'fr' };
    expect(studioScopeSelectionSchema.parse(selection)).toEqual(selection);
    for (const change of [
      { tenantId: 'other' },
      { workspaceId: 'other' },
      { siteId: '../escape' },
      { locale: '' },
    ]) {
      expect(studioScopeSelectionSchema.safeParse({ ...selection, ...change }).success).toBe(false);
    }
  });

  it('validates bounded topology shape, uniqueness and complete ownership', () => {
    expect(studioTopologySchema.safeParse(topology()).success).toBe(true);
    const duplicate = topology();
    duplicate.sites.push(required(duplicate.sites[0]));
    expect(studioTopologySchema.safeParse(duplicate).success).toBe(false);
    const orphan = topology();
    required(orphan.tenants[0]).organizationId = 'unknown';
    expect(studioTopologySchema.safeParse(orphan).success).toBe(false);
    for (const change of [
      { secrets: 'not-allowed' },
      {
        sites: Array.from({ length: 257 }, (_, i) => ({
          id: `s${i}`,
          name: 'Site',
          workspaceId: 'workspace',
          status: 'active',
        })),
      },
    ]) {
      expect(studioTopologySchema.safeParse({ ...topology(), ...change }).success).toBe(false);
    }
    const locale = topology();
    locale.locales.push(required(locale.locales[0]));
    expect(studioTopologySchema.safeParse(locale).success).toBe(false);
  });
});
