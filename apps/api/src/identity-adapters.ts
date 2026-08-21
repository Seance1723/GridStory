import {
  type EnterpriseIdentityService,
  GridStoryError,
  type IdentityTenantScope,
} from '@gridstory/core';
import type { FederatedIdentity, IdentitySnapshot } from '@gridstory/schema';
import { type CacheProvider, SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import * as oidc from 'openid-client';

export interface OidcAdapterConfig {
  id: string;
  protocol: 'oidc';
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes?: string[];
  groupClaim?: string;
}

export interface SamlAdapterConfig {
  id: string;
  protocol: 'saml';
  issuer: string;
  entryPoint: string;
  idpCertificate: string;
  serviceProviderIssuer: string;
  callbackUrl: string;
  groupAttribute?: string;
}

export type FederationAdapterConfig = OidcAdapterConfig | SamlAdapterConfig;

export interface FederationAdapter {
  readonly id: string;
  readonly protocol: 'oidc' | 'saml';
  start(scope: IdentityTenantScope): Promise<string>;
  complete(
    scope: IdentityTenantScope,
    input: { callbackUrl?: string; body?: Record<string, string> },
  ): Promise<FederatedIdentity>;
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringListClaim(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  }
  return typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function oidcStrength(amr: unknown): FederatedIdentity['strength'] {
  const methods = stringListClaim(amr).map((value) => value.toLowerCase());
  if (methods.some((method) => ['hwk', 'fido', 'webauthn'].includes(method))) {
    return 'phishing-resistant';
  }
  if (methods.some((method) => ['mfa', 'otp', 'sms', 'swk'].includes(method))) {
    return 'multi-factor';
  }
  return 'single-factor';
}

export class OidcFederationAdapter implements FederationAdapter {
  readonly id: string;
  readonly protocol = 'oidc' as const;
  readonly #options: OidcAdapterConfig;
  readonly #identity: EnterpriseIdentityService;
  #configuration?: Promise<oidc.Configuration>;

  constructor(options: OidcAdapterConfig, identity: EnterpriseIdentityService) {
    this.id = options.id;
    this.#options = options;
    this.#identity = identity;
  }

  #client(): Promise<oidc.Configuration> {
    this.#configuration ??= oidc.discovery(
      new URL(this.#options.issuer),
      this.#options.clientId,
      {
        redirect_uris: [this.#options.redirectUri],
        response_types: ['code'],
        ...(this.#options.clientSecret ? { client_secret: this.#options.clientSecret } : {}),
      },
      this.#options.clientSecret ? oidc.ClientSecretPost(this.#options.clientSecret) : oidc.None(),
    );
    return this.#configuration;
  }

  async start(scope: IdentityTenantScope): Promise<string> {
    const [configuration, transaction] = await Promise.all([
      this.#client(),
      this.#identity.createFederationTransaction(scope, 'oidc'),
    ]);
    const codeChallenge = await oidc.calculatePKCECodeChallenge(transaction.codeVerifier);
    return oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.#options.redirectUri,
      response_type: 'code',
      scope: (this.#options.scopes ?? ['openid', 'profile', 'email']).join(' '),
      state: transaction.token,
      nonce: transaction.nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).href;
  }

  async complete(
    scope: IdentityTenantScope,
    input: { callbackUrl?: string },
  ): Promise<FederatedIdentity> {
    if (!input.callbackUrl) {
      throw new GridStoryError('OIDC callback URL is required.', 'invalid_identity', 401);
    }
    const callbackUrl = new URL(this.#options.redirectUri);
    callbackUrl.search = new URL(input.callbackUrl, this.#options.redirectUri).search;
    const state = callbackUrl.searchParams.get('state');
    if (!state) throw new GridStoryError('OIDC state is required.', 'invalid_identity', 401);
    const transaction = await this.#identity.consumeFederationTransaction(scope, 'oidc', state);
    const tokens = await oidc.authorizationCodeGrant(await this.#client(), callbackUrl, {
      expectedState: state,
      expectedNonce: transaction.nonce,
      pkceCodeVerifier: transaction.codeVerifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new GridStoryError('OIDC subject is missing.', 'invalid_identity', 401);
    const authenticatedAt =
      typeof claims.auth_time === 'number'
        ? new Date(claims.auth_time * 1_000).toISOString()
        : new Date().toISOString();
    const groupClaim = this.#options.groupClaim ?? 'groups';
    return {
      providerId: this.id,
      protocol: 'oidc',
      issuer: this.#options.issuer,
      subject: claims.sub,
      ...(stringClaim(claims.email) ? { email: stringClaim(claims.email) } : {}),
      ...(typeof claims.email_verified === 'boolean'
        ? { emailVerified: claims.email_verified }
        : {}),
      ...(stringClaim(claims.name) ? { displayName: stringClaim(claims.name) } : {}),
      groups: stringListClaim(claims[groupClaim]),
      authenticatedAt,
      strength: oidcStrength(claims.amr),
    };
  }
}

class DurableSamlCacheProvider implements CacheProvider {
  readonly #identity: EnterpriseIdentityService;
  readonly #scope: IdentityTenantScope;

  constructor(identity: EnterpriseIdentityService, scope: IdentityTenantScope) {
    this.#identity = identity;
    this.#scope = scope;
  }

  async saveAsync(key: string, value: string) {
    await this.#identity.saveProtocolRequest(this.#scope, key, value);
    return { value, createdAt: Date.now() };
  }

  getAsync(key: string): Promise<string | null> {
    return this.#identity.getProtocolRequest(this.#scope, key);
  }

  removeAsync(key: string | null): Promise<string | null> {
    return key ? this.#identity.removeProtocolRequest(this.#scope, key) : Promise.resolve(null);
  }
}

export class SamlFederationAdapter implements FederationAdapter {
  readonly id: string;
  readonly protocol = 'saml' as const;
  readonly #options: SamlAdapterConfig;
  readonly #identity: EnterpriseIdentityService;

  constructor(options: SamlAdapterConfig, identity: EnterpriseIdentityService) {
    this.id = options.id;
    this.#options = options;
    this.#identity = identity;
  }

  #saml(scope: IdentityTenantScope): SAML {
    return new SAML({
      entryPoint: this.#options.entryPoint,
      idpCert: this.#options.idpCertificate,
      idpIssuer: this.#options.issuer,
      issuer: this.#options.serviceProviderIssuer,
      callbackUrl: this.#options.callbackUrl,
      audience: this.#options.serviceProviderIssuer,
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: 10 * 60 * 1_000,
      cacheProvider: new DurableSamlCacheProvider(this.#identity, scope),
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
      acceptedClockSkewMs: 60_000,
      maxAssertionAgeMs: 5 * 60 * 1_000,
      signatureAlgorithm: 'sha256',
      digestAlgorithm: 'sha256',
    });
  }

  async start(scope: IdentityTenantScope): Promise<string> {
    const transaction = await this.#identity.createFederationTransaction(scope, 'saml');
    return this.#saml(scope).getAuthorizeUrlAsync(transaction.token, undefined, {});
  }

  async complete(
    scope: IdentityTenantScope,
    input: { body?: Record<string, string> },
  ): Promise<FederatedIdentity> {
    const relayState = input.body?.RelayState;
    const samlResponse = input.body?.SAMLResponse;
    if (!relayState || !samlResponse) {
      throw new GridStoryError(
        'SAML response and RelayState are required.',
        'invalid_identity',
        401,
      );
    }
    await this.#identity.consumeFederationTransaction(scope, 'saml', relayState);
    const { profile, loggedOut } = await this.#saml(scope).validatePostResponseAsync({
      SAMLResponse: samlResponse,
    });
    if (loggedOut || !profile?.nameID) {
      throw new GridStoryError('SAML subject is missing.', 'invalid_identity', 401);
    }
    const groupAttribute = this.#options.groupAttribute ?? 'groups';
    return {
      providerId: this.id,
      protocol: 'saml',
      issuer: this.#options.issuer,
      subject: profile.nameID,
      ...(stringClaim(profile.email ?? profile.mail)
        ? {
            email: stringClaim(profile.email ?? profile.mail),
          }
        : {}),
      ...(stringClaim(profile.displayName)
        ? { displayName: stringClaim(profile.displayName) }
        : {}),
      groups: stringListClaim(profile[groupAttribute]),
      authenticatedAt: new Date().toISOString(),
      strength: 'single-factor',
    };
  }
}

export interface WebAuthnAdapterOptions {
  rpName: string;
  rpId: string;
  origins: string[];
}

export class WebAuthnAdapter {
  readonly #options: WebAuthnAdapterOptions;

  constructor(options: WebAuthnAdapterOptions) {
    if (options.origins.length === 0) throw new Error('At least one WebAuthn origin is required.');
    this.#options = options;
  }

  registrationOptions(snapshot: IdentitySnapshot, userId: string) {
    const user = snapshot.users.find((candidate) => candidate.id === userId && candidate.active);
    if (!user) throw new GridStoryError('Active directory user was not found.', 'not_found', 404);
    const credentials = snapshot.credentials.filter(
      (credential) => credential.userId === user.id && !credential.revokedAt,
    );
    return generateRegistrationOptions({
      rpName: this.#options.rpName,
      rpID: this.#options.rpId,
      userName: user.userName,
      userDisplayName: user.displayName ?? user.userName,
      userID: Buffer.from(user.id, 'utf8'),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      excludeCredentials: credentials.map((credential) => ({
        id: credential.id,
        transports: credential.transports as AuthenticatorTransportFuture[],
      })),
    });
  }

  authenticationOptions(snapshot: IdentitySnapshot, userId: string) {
    const credentials = snapshot.credentials.filter(
      (credential) => credential.userId === userId && !credential.revokedAt,
    );
    return generateAuthenticationOptions({
      rpID: this.#options.rpId,
      userVerification: 'required',
      allowCredentials: credentials.map((credential) => ({
        id: credential.id,
        transports: credential.transports as AuthenticatorTransportFuture[],
      })),
    });
  }

  async verifyRegistration(response: RegistrationResponseJSON, expectedChallenge: string) {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.#options.origins,
      expectedRPID: this.#options.rpId,
      requireUserVerification: true,
    });
    if (!result.verified || !result.registrationInfo) {
      throw new GridStoryError('WebAuthn registration is invalid.', 'invalid_identity', 401);
    }
    const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: response.response.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    };
  }

  async verifyAuthentication(
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    snapshot: IdentitySnapshot,
  ) {
    const credential = snapshot.credentials.find(
      (candidate) => candidate.id === response.id && !candidate.revokedAt,
    );
    if (!credential) {
      throw new GridStoryError('WebAuthn credential was not found.', 'invalid_identity', 401);
    }
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.#options.origins,
      expectedRPID: this.#options.rpId,
      requireUserVerification: true,
      credential: {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey, 'base64url'),
        counter: credential.counter,
        transports: credential.transports as AuthenticatorTransportFuture[],
      },
    });
    if (!result.verified) {
      throw new GridStoryError('WebAuthn assertion is invalid.', 'invalid_identity', 401);
    }
    return {
      credentialId: result.authenticationInfo.credentialID,
      newCounter: result.authenticationInfo.newCounter,
    };
  }
}

export function createFederationAdapters(
  configurations: FederationAdapterConfig[],
  identity: EnterpriseIdentityService,
): Map<string, FederationAdapter> {
  return new Map(
    configurations.map((configuration) => {
      const adapter =
        configuration.protocol === 'oidc'
          ? new OidcFederationAdapter(configuration, identity)
          : new SamlFederationAdapter(configuration, identity);
      return [adapter.id, adapter];
    }),
  );
}
