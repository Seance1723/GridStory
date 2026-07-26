import type { ContentPerspective } from './content.js';

export interface Organization {
  id: string;
  name: string;
  status: 'active' | 'suspended';
}

export interface Tenant {
  id: string;
  organizationId: string;
  name: string;
  status: 'active' | 'suspended';
}

export interface Workspace {
  id: string;
  tenantId: string;
  name: string;
  status: 'active' | 'archived';
}

export interface Site {
  id: string;
  workspaceId: string;
  name: string;
  status: 'active' | 'archived';
}

export interface Environment {
  id: string;
  siteId: string;
  name: string;
  kind: 'development' | 'preview' | 'production';
  status: 'active' | 'locked';
}

export interface LocaleConfiguration {
  code: string;
  siteId: string;
  label: string;
  fallbackLocale?: string;
  fallbackLocales?: string[];
  routePrefix?: string;
  required?: boolean;
  default: boolean;
  enabled: boolean;
}

export type PrincipalType = 'user' | 'service-account' | 'anonymous';

export interface AuthorizationGrant {
  actions: string[];
  organizationId?: string;
  tenantId?: string;
  workspaceId?: string;
  siteId?: string;
  environmentIds?: string[];
  locales?: string[];
  contentTypes?: string[];
}

export interface RoleAssignment extends Omit<AuthorizationGrant, 'actions'> {
  roleId: string;
}

export interface Principal {
  id: string;
  type: PrincipalType;
  roles: string[];
  roleAssignments?: RoleAssignment[];
  grants?: AuthorizationGrant[];
  attributes?: Record<string, string | string[] | boolean | number>;
  authenticationMethod?: 'oidc' | 'session' | 'service-token' | 'development' | 'anonymous';
}

export interface RequestContext {
  organizationId: string;
  tenantId: string;
  workspaceId: string;
  siteId: string;
  environmentId: string;
  locale: string;
  perspective: ContentPerspective;
  principal: Principal;
}

export type ContentScope = Pick<
  RequestContext,
  'organizationId' | 'tenantId' | 'workspaceId' | 'siteId' | 'environmentId' | 'locale'
>;

export interface OidcIdentity {
  issuer: string;
  subject: string;
  audience: string[];
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  groups: string[];
  issuedAt: number;
  expiresAt: number;
}

export interface IdentitySession {
  id: string;
  principalId: string;
  tenantId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  authenticationMethod: 'oidc';
  revokedAt?: string;
}

export interface ServiceAccount {
  id: string;
  tenantId: string;
  name: string;
  status: 'active' | 'disabled';
  grants: AuthorizationGrant[];
  createdAt: string;
  rotatedAt?: string;
}

export interface ScopedTokenClaims {
  tokenId: string;
  issuer: string;
  audience: string[];
  subject: string;
  principalType: Exclude<PrincipalType, 'anonymous'>;
  grants: AuthorizationGrant[];
  issuedAt: number;
  expiresAt: number;
  notBefore?: number;
}

export interface PlatformTopology {
  organizations: Organization[];
  tenants: Tenant[];
  workspaces: Workspace[];
  sites: Site[];
  environments: Environment[];
  locales: LocaleConfiguration[];
}
