import { z } from 'zod';

const identityIdSchema = z.string().trim().min(1).max(128);
const identityNameSchema = z.string().trim().min(1).max(256);
const identityScopeSchema = z.object({
  organizationId: identityIdSchema,
  tenantId: identityIdSchema,
});
const timestampSchema = z.string().datetime();

export const federationProtocolSchema = z.enum(['oidc', 'saml']);
export type FederationProtocol = z.infer<typeof federationProtocolSchema>;

export const authenticationStrengthSchema = z.enum([
  'single-factor',
  'multi-factor',
  'phishing-resistant',
  'break-glass',
]);
export type AuthenticationStrength = z.infer<typeof authenticationStrengthSchema>;

export const identityProviderSchema = identityScopeSchema.extend({
  id: identityIdSchema,
  protocol: federationProtocolSchema,
  issuer: z.string().url().max(2048),
  displayName: identityNameSchema,
  enabled: z.boolean(),
  allowJitProvisioning: z.boolean().default(false),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type IdentityProvider = z.infer<typeof identityProviderSchema>;

export const federatedIdentitySchema = z.object({
  providerId: identityIdSchema,
  protocol: federationProtocolSchema,
  issuer: z.string().url().max(2048),
  subject: identityIdSchema,
  email: z.string().email().max(320).optional(),
  emailVerified: z.boolean().optional(),
  displayName: identityNameSchema.optional(),
  groups: z.array(identityIdSchema).max(500).default([]),
  authenticatedAt: timestampSchema,
  strength: authenticationStrengthSchema,
});
export type FederatedIdentity = z.infer<typeof federatedIdentitySchema>;

export const identityProviderLinkSchema = z.object({
  providerId: identityIdSchema,
  subject: identityIdSchema,
});
export type IdentityProviderLink = z.infer<typeof identityProviderLinkSchema>;

export const directoryUserSchema = identityScopeSchema.extend({
  id: identityIdSchema,
  userName: z.string().trim().min(1).max(320),
  externalId: identityIdSchema.optional(),
  displayName: identityNameSchema.optional(),
  emails: z.array(z.string().email().max(320)).max(20).default([]),
  active: z.boolean(),
  providerLinks: z.array(identityProviderLinkSchema).max(20).default([]),
  federatedGroups: z.array(identityIdSchema).max(500).default([]),
  groupIds: z.array(identityIdSchema).max(500).default([]),
  version: z.number().int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type DirectoryUser = z.infer<typeof directoryUserSchema>;

export const directoryGroupSchema = identityScopeSchema.extend({
  id: identityIdSchema,
  displayName: identityNameSchema,
  externalId: identityIdSchema.optional(),
  memberIds: z.array(identityIdSchema).max(10_000).default([]),
  version: z.number().int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type DirectoryGroup = z.infer<typeof directoryGroupSchema>;

export const groupRoleMappingSchema = identityScopeSchema.extend({
  id: identityIdSchema,
  externalGroup: identityIdSchema,
  roleId: identityIdSchema,
  workspaceId: identityIdSchema.optional(),
  siteId: identityIdSchema.optional(),
  environmentIds: z.array(identityIdSchema).max(50).optional(),
  locales: z.array(identityIdSchema).max(100).optional(),
  contentTypes: z.array(identityIdSchema).max(100).optional(),
  createdBy: identityIdSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type GroupRoleMapping = z.infer<typeof groupRoleMappingSchema>;

export const sessionPolicySchema = z
  .object({
    idleTtlSeconds: z.number().int().min(60).max(86_400),
    absoluteTtlSeconds: z.number().int().min(300).max(604_800),
    reauthenticationSeconds: z.number().int().min(60).max(86_400),
    maximumConcurrentSessions: z.number().int().min(1).max(100),
    privilegedStepUpRequired: z.boolean(),
    breakGlassTtlSeconds: z.number().int().min(60).max(3_600),
    maximumFailedBreakGlassAttempts: z.number().int().min(1).max(20),
  })
  .refine((value) => value.idleTtlSeconds <= value.absoluteTtlSeconds, {
    message: 'Idle session lifetime cannot exceed the absolute lifetime.',
    path: ['idleTtlSeconds'],
  })
  .refine((value) => value.reauthenticationSeconds <= value.absoluteTtlSeconds, {
    message: 'Reauthentication lifetime cannot exceed the absolute lifetime.',
    path: ['reauthenticationSeconds'],
  });
export type SessionPolicy = z.infer<typeof sessionPolicySchema>;

export const defaultSessionPolicy: SessionPolicy = {
  idleTtlSeconds: 30 * 60,
  absoluteTtlSeconds: 8 * 60 * 60,
  reauthenticationSeconds: 30 * 60,
  maximumConcurrentSessions: 5,
  privilegedStepUpRequired: true,
  breakGlassTtlSeconds: 15 * 60,
  maximumFailedBreakGlassAttempts: 5,
};

export const identitySessionSchema = identityScopeSchema.extend({
  id: identityIdSchema,
  userId: identityIdSchema.optional(),
  principalId: identityIdSchema,
  providerId: identityIdSchema.optional(),
  createdAt: timestampSchema,
  lastSeenAt: timestampSchema,
  idleExpiresAt: timestampSchema,
  expiresAt: timestampSchema,
  reauthenticateAt: timestampSchema,
  authenticationMethod: z.enum(['oidc', 'saml', 'webauthn', 'break-glass']),
  authenticationStrength: authenticationStrengthSchema,
  nonRenewable: z.boolean().default(false),
  revokedAt: timestampSchema.optional(),
  revokedReason: z.string().trim().min(1).max(500).optional(),
});
export type IdentitySession = z.infer<typeof identitySessionSchema>;

export const webAuthnCredentialSchema = identityScopeSchema.extend({
  id: identityIdSchema,
  userId: identityIdSchema,
  publicKey: z.string().min(1).max(8192),
  counter: z.number().int().nonnegative(),
  transports: z.array(z.string().min(1).max(40)).max(16).default([]),
  deviceType: z.enum(['singleDevice', 'multiDevice']),
  backedUp: z.boolean(),
  createdAt: timestampSchema,
  lastUsedAt: timestampSchema.optional(),
  revokedAt: timestampSchema.optional(),
});
export type WebAuthnCredential = z.infer<typeof webAuthnCredentialSchema>;

export const breakGlassAccountSchema = identityScopeSchema.extend({
  id: identityIdSchema,
  name: identityNameSchema,
  roleId: identityIdSchema,
  status: z.enum(['active', 'used', 'revoked', 'expired']),
  createdBy: identityIdSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  usedAt: timestampSchema.optional(),
  revokedAt: timestampSchema.optional(),
});
export type BreakGlassAccount = z.infer<typeof breakGlassAccountSchema>;

export const identitySecurityEventActionSchema = z.enum([
  'identity.provider.configured',
  'identity.policy.updated',
  'identity.federation.succeeded',
  'identity.federation.failed',
  'identity.user.provisioned',
  'identity.user.updated',
  'identity.user.deprovisioned',
  'identity.user.erased',
  'identity.group.provisioned',
  'identity.group.updated',
  'identity.group.deprovisioned',
  'identity.mapping.created',
  'identity.mapping.deleted',
  'identity.session.created',
  'identity.session.revoked',
  'identity.session.expired',
  'identity.webauthn.registered',
  'identity.webauthn.verified',
  'identity.webauthn.revoked',
  'identity.break_glass.created',
  'identity.break_glass.failed',
  'identity.break_glass.activated',
  'identity.break_glass.revoked',
]);
export type IdentitySecurityEventAction = z.infer<typeof identitySecurityEventActionSchema>;

export const identitySecurityEventSchema = identityScopeSchema.extend({
  id: identityIdSchema,
  sequence: z.number().int().positive(),
  action: identitySecurityEventActionSchema,
  outcome: z.enum(['success', 'denied', 'error']),
  actorId: identityIdSchema,
  subjectId: identityIdSchema.optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  incidentId: identityIdSchema.optional(),
  occurredAt: timestampSchema,
});
export type IdentitySecurityEvent = z.infer<typeof identitySecurityEventSchema>;

export const identitySnapshotSchema = identityScopeSchema.extend({
  version: z.number().int().nonnegative(),
  providers: z.array(identityProviderSchema).max(50),
  users: z.array(directoryUserSchema).max(100_000),
  groups: z.array(directoryGroupSchema).max(10_000),
  mappings: z.array(groupRoleMappingSchema).max(10_000),
  sessions: z.array(identitySessionSchema).max(100_000),
  credentials: z.array(webAuthnCredentialSchema).max(100_000),
  breakGlassAccounts: z.array(breakGlassAccountSchema).max(100),
  policy: sessionPolicySchema,
  securityEvents: z.array(identitySecurityEventSchema).max(100_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type IdentitySnapshot = z.infer<typeof identitySnapshotSchema>;

export const scimUserInputSchema = z.object({
  schemas: z.array(z.string().min(1).max(256)).max(20).optional(),
  externalId: identityIdSchema.optional(),
  userName: z.string().trim().min(1).max(320),
  displayName: identityNameSchema.optional(),
  active: z.boolean().default(true),
  emails: z
    .array(z.object({ value: z.string().email().max(320), primary: z.boolean().optional() }))
    .max(20)
    .default([]),
});
export type ScimUserInput = z.infer<typeof scimUserInputSchema>;

export const scimGroupInputSchema = z.object({
  schemas: z.array(z.string().min(1).max(256)).max(20).optional(),
  externalId: identityIdSchema.optional(),
  displayName: identityNameSchema,
  members: z
    .array(z.object({ value: identityIdSchema, display: identityNameSchema.optional() }))
    .max(10_000)
    .default([]),
});
export type ScimGroupInput = z.infer<typeof scimGroupInputSchema>;

export const scimPatchSchema = z.object({
  schemas: z.array(z.literal('urn:ietf:params:scim:api:messages:2.0:PatchOp')).min(1),
  Operations: z
    .array(
      z.object({
        op: z.enum(['add', 'remove', 'replace']),
        path: z.string().trim().min(1).max(500).optional(),
        value: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(100),
});
export type ScimPatch = z.infer<typeof scimPatchSchema>;
