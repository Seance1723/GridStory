import type {
  AiGatewayDocument,
  AiGatewayPolicyInput,
  AiGatewayStateInput,
  AiGenerateInput,
  AiGenerateResult,
  AiPromptVersionInput,
  AssetDeliveryGrant,
  AnalyticsIngestionResult,
  AnalyticsReport,
  AssetRecord,
  AssetRendition,
  AssetRenditionPreset,
  AssetUploadPart,
  AssetUploadSession,
  AssetUsageReport,
  BacklinkRecord,
  CollaborationBranch,
  CollaborationConflict,
  CollaborationMerge,
  CollaborationOperation,
  CollaborationOperationInput,
  CollaborationSnapshot,
  CollaborationSuggestion,
  CollaborationTarget,
  CommentThread,
  ComponentManifest,
  ContentConnection,
  ContentEntry,
  ContentFilter,
  ContentFilterOperator,
  ContentPerspective,
  ContentQualityReport,
  ContentQuery,
  ContentRevision,
  ContentSchemaDefinition,
  ContentSort,
  CreateAssetDeliveryInput,
  DataSubject,
  DataSubjectRequest,
  DesignSystemManifest,
  ExperimentAllocationRequest,
  ExperimentAllocationResult,
  ExperimentDesign,
  ExperimentMetricSnapshotInput,
  ExperimentOverview,
  ExperimentPromotionRequest,
  ExperimentTransitionRequest,
  GovernanceBackupEvidence,
  GovernanceExportEnvelope,
  GovernanceExportPackage,
  GovernancePlan,
  GovernancePolicyInput,
  GovernanceSnapshot,
  GroupRoleMapping,
  IdentityProvider,
  IdentitySession,
  IdentitySnapshot,
  LegalHold,
  LocaleConfiguration,
  LocalizedContentResolution,
  MarketplaceDomainChallenge,
  MarketplaceOverview,
  MarketplacePublisherInput,
  MarketplacePublisherSummary,
  MarketplaceReleaseSubmission,
  MarketplaceReleaseSummary,
  PersonalizationConfiguration,
  PersonalizationDecisionRequest,
  PersonalizationDecisionResult,
  PersonalizationPreviewRequest,
  PersonalizationPreviewResult,
  PersonalizationSnapshot,
  MigrationCutoverReport,
  MigrationPlanSummary,
  MigrationProjectInput,
  MigrationProjectSummary,
  MigrationRecipe,
  MigrationRecipeInput,
  MigrationRun,
  MigrationSourceDescriptor,
  PluginCapabilityGrant,
  PluginCapabilityName,
  PluginInstallation,
  PluginInvocationResult,
  PluginUninstallPreview,
  PublicAnalyticsEventInput,
  PresenceParticipant,
  PreviewMessage,
  PreviewMode,
  PreviewSessionGrant,
  RelatedContentRecord,
  Release,
  ReleaseInput,
  ReleasePreview,
  RequestContext,
  ResidencyStatus,
  ResolvedComponentManifest,
  SchemaDriftReport,
  SchemaIrDocument,
  SchemaMigrationPlan,
  SearchIndexStatus,
  SearchQuery,
  SearchResponse,
  SessionPolicy,
  SignedPluginManifest,
  StartAssetUploadInput,
  SubjectResourceLink,
  TaxonomyDefinition,
  TranslationCompletenessReport,
  UpdateAssetInput,
  ValidationIssue,
  VisualModelDocument,
  WorkflowDefinition,
  WorkflowDefinitionInput,
  WorkflowInstance,
} from '@gridstory/schema';

export interface MigrationOverviewRecord {
  sources: MigrationSourceDescriptor[];
  recipes: MigrationRecipe[];
  projects: MigrationProjectSummary[];
  plans: MigrationPlanSummary[];
  runs: MigrationRun[];
  cutoverReports: MigrationCutoverReport[];
}

export type MarketplaceOverviewRecord = MarketplaceOverview;

export interface SchemaDeploymentRecord {
  document: SchemaIrDocument;
  fingerprint: string;
  generatedTypes: string;
  generatedTypesFingerprint: string;
  migrationPlanId?: string;
  deployedAt: string;
  actorId: string;
}

export interface SchemaLifecycleInspection {
  source: SchemaIrDocument;
  visualModel: VisualModelDocument;
  fingerprint: string;
  generatedTypes: string;
  generatedTypesFingerprint: string;
  deployment: SchemaDeploymentRecord | null;
}

export interface SchemaMigrationAssessmentResponse {
  plan: SchemaMigrationPlan;
  impact: {
    scannedEntries: number;
    affectedEntries: number;
    byContentType: Record<string, number>;
    invalidEntries: Array<{
      entryId: string;
      contentType: string;
      issues: ValidationIssue[];
    }>;
  };
}
export interface ComponentUsageLocation {
  entryId: string;
  contentType: string;
  perspective: ContentPerspective;
  revisionId: string;
  field: string;
  nodeId: string;
  path: string;
  version: number;
}

export interface ComponentUsageReport {
  componentId: string;
  currentVersion: number;
  totalInstances: number;
  entries: number;
  byPerspective: Record<ContentPerspective, number>;
  byVersion: Record<string, number>;
  locations: ComponentUsageLocation[];
}

export interface ComponentMigrationPlanResponse {
  id: string;
  component: ResolvedComponentManifest;
  usage: ComponentUsageReport;
  outdatedInstances: number;
  unmigratableVersions: number[];
  ready: boolean;
}

export interface ComponentVisualRegressionPlan {
  id: string;
  componentId: string;
  version: number;
  scenarios: ResolvedComponentManifest['visualRegression']['scenarios'];
  usageHooks: ComponentUsageLocation[];
  selector: string;
}

export interface ComponentMigrationResult {
  entry: ContentEntry;
  migratedInstances: number;
  fromVersions: number[];
}

export type ContentEventType = 'content.created' | 'content.draft.updated' | 'content.published';

export interface OutboxEventRecord {
  id: string;
  type: ContentEventType;
  aggregateId: string;
  revisionId: string;
  payload: Record<string, unknown>;
  cacheTags: string[];
  state: 'pending' | 'processing' | 'succeeded' | 'dead';
  attempts: number;
  occurredAt: string;
  availableAt: string;
}

export interface DurableJobRecord {
  id: string;
  type:
    | 'cache.invalidate'
    | 'webhook.deliver'
    | 'workflow.action'
    | 'search.index'
    | 'search.rebuild';
  idempotencyKey: string;
  payload: Record<string, unknown>;
  state: 'pending' | 'processing' | 'succeeded' | 'dead';
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lastError?: string;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookSubscriptionRecord {
  id: string;
  url: string;
  eventTypes: ContentEventType[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OperationsDrainResult {
  claimedOutbox: number;
  completedOutbox: number;
  enqueuedJobs: number;
  claimedJobs: number;
  completedJobs: number;
  retriedJobs: number;
  deadJobs: number;
}

export interface WorkflowActionDrainResult {
  reconciliation: { discovered: number; reconciled: number };
  delivery: OperationsDrainResult;
}

export interface LogicalArchiveRevision {
  id: string;
  sequence: number;
  baseRevisionId?: string;
  actorId: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface LogicalArchiveRecord {
  entryId: string;
  contentType: string;
  currentDraftRevisionId: string;
  publishedRevisionId?: string;
  translationGroupId: string;
  createdAt: string;
  updatedAt: string;
  revisions: LogicalArchiveRevision[];
  auditEvents: Array<{
    id: string;
    sequence: number;
    actorId: string;
    action: ContentEventType;
    revisionId: string;
    occurredAt: string;
  }>;
}

export interface LogicalContentArchive {
  manifest: {
    kind: 'manifest';
    format: 'gridstory.logical-content';
    version: 1;
    sourceScope: Pick<
      RequestContext,
      'organizationId' | 'tenantId' | 'workspaceId' | 'siteId' | 'environmentId' | 'locale'
    >;
    exportedAt: string;
    entryCount: number;
    archiveChecksum: string;
    schemaFingerprint?: string;
  };
  entries: Array<{
    kind: 'entry';
    checksum: string;
    record: LogicalArchiveRecord;
  }>;
}

export interface LogicalImportResult {
  imported: number;
  skipped: number;
  replaced: number;
  conflicts: string[];
  dryRun: boolean;
}

export interface AuditEventRecord {
  id: string;
  organizationId: string;
  tenantId: string;
  workspaceId: string;
  siteId: string;
  environmentId: string;
  locale: string;
  entryId: string;
  sequence: number;
  actorId: string;
  action: ContentEventType;
  revisionId: string;
  occurredAt: string;
  previousHash?: string;
  eventHash: string;
}

export interface AuditVerificationRecord {
  valid: boolean;
  eventCount: number;
  entryCount: number;
  failures: Array<{
    eventId: string;
    entryId: string;
    reason: 'sequence_mismatch' | 'previous_hash_mismatch' | 'event_hash_mismatch';
  }>;
}

export interface AuditExportRecord {
  manifest: {
    kind: 'gridstory.audit.manifest';
    version: 1;
    scope: LogicalContentArchive['manifest']['sourceScope'];
    exportedAt: string;
    eventCount: number;
    entryCount: number;
    auditChecksum: string;
    valid: boolean;
  };
  events: AuditEventRecord[];
  failures: AuditVerificationRecord['failures'];
}

export interface OperationsDashboardRecord {
  generatedAt: string;
  content: { total: number; draft: number; changed: number; published: number };
  outbox: Record<'pending' | 'processing' | 'succeeded' | 'dead', number> & {
    total: number;
    truncated: boolean;
  };
  jobs: Record<'pending' | 'processing' | 'succeeded' | 'dead', number> & {
    total: number;
    truncated: boolean;
  };
  webhooks: { total: number; active: number };
  audit: AuditVerificationRecord;
  recentAudit: AuditEventRecord[];
}

export interface GridStoryClientOptions {
  baseUrl: string;
  tenantId: string;
  actorId?: string;
  scope?: Partial<
    Pick<RequestContext, 'organizationId' | 'workspaceId' | 'siteId' | 'environmentId' | 'locale'>
  >;
  fetch?: typeof globalThis.fetch;
  developmentIdentityHeaders?: boolean;
}

export interface CreateCommentThreadInput {
  target?: Omit<CollaborationTarget, 'entryId'>;
  body: string;
  mentions?: string[];
  assigneeId?: string;
  dueAt?: string;
  signal?: AbortSignal;
}

export interface UpdateCommentThreadInput {
  assigneeId?: string | null;
  dueAt?: string | null;
  resolved?: boolean;
  signal?: AbortSignal;
}

export interface PresenceHeartbeatInput {
  displayName: string;
  field?: string;
  nodeId?: string;
  signal?: AbortSignal;
}

export interface SubmitCollaborationOperationInput extends CollaborationOperationInput {
  signal?: AbortSignal;
}

export interface CreateCollaborationBranchInput {
  name: string;
  parentBranchId?: string;
  id?: string;
  signal?: AbortSignal;
}

export interface CreateCollaborationSuggestionInput {
  branchId?: string;
  target: CollaborationOperationInput['target'];
  kind?: CollaborationOperation['kind'];
  value?: CollaborationOperation['value'];
  id?: string;
  signal?: AbortSignal;
}

export interface ResolveCollaborationConflictInput {
  operationId?: string;
  value?: CollaborationOperation['value'];
  kind?: CollaborationOperation['kind'];
  actorSequence?: number;
  signal?: AbortSignal;
}
export interface CreatePreviewSessionInput {
  previewUrl: string;
  route: string;
  mode: PreviewMode;
  entryId?: string;
  ttlSeconds?: number;
  signal?: AbortSignal;
}

export interface InstallPluginInput {
  manifest: SignedPluginManifest;
  artifactDigest: string;
  grantedCapabilities: PluginCapabilityGrant[];
  reason: string;
  signal?: AbortSignal;
}

export interface ApproveMarketplacePublisherInput {
  evidenceReference: string;
  reason: string;
  signal?: AbortSignal;
}

export interface InstallMarketplaceReleaseInput {
  releaseId: string;
  grantedCapabilities: PluginCapabilityGrant[];
  reason: string;
  signal?: AbortSignal;
}

export interface GridStoryErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    requestId?: string;
  };
}

export class GridStoryApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    message: string,
    options: { status: number; code?: string; details?: unknown; requestId?: string },
  ) {
    super(message);
    this.name = 'GridStoryApiError';
    this.status = options.status;
    this.code = options.code ?? 'request_failed';
    if (options.details !== undefined) this.details = options.details;
    if (options.requestId !== undefined) this.requestId = options.requestId;
  }
}

export class GridStoryClient {
  readonly #baseUrl: string;
  readonly #tenantId: string;
  readonly #actorId: string;
  readonly #scope: Required<NonNullable<GridStoryClientOptions['scope']>>;
  readonly #fetch: typeof globalThis.fetch;
  readonly #developmentIdentityHeaders: boolean;

  constructor({
    baseUrl,
    tenantId,
    actorId = 'local-admin',
    scope = {},
    fetch,
    developmentIdentityHeaders = true,
  }: GridStoryClientOptions) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#tenantId = tenantId;
    this.#actorId = actorId;
    this.#scope = {
      organizationId: scope.organizationId ?? 'local',
      workspaceId: scope.workspaceId ?? 'default',
      siteId: scope.siteId ?? 'default',
      environmentId: scope.environmentId ?? 'development',
      locale: scope.locale ?? 'en',
    };
    this.#fetch = fetch ?? globalThis.fetch.bind(globalThis);
    this.#developmentIdentityHeaders = developmentIdentityHeaders;
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      credentials: init.credentials ?? 'include',
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        'x-gridstory-organization': this.#scope.organizationId,
        'x-gridstory-tenant': this.#tenantId,
        'x-gridstory-workspace': this.#scope.workspaceId,
        'x-gridstory-site': this.#scope.siteId,
        'x-gridstory-environment': this.#scope.environmentId,
        'x-gridstory-locale': this.#scope.locale,
        ...(this.#developmentIdentityHeaders ? { 'x-gridstory-actor': this.#actorId } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      let envelope: GridStoryErrorEnvelope = {};
      try {
        envelope = (await response.json()) as GridStoryErrorEnvelope;
      } catch {
        // Keep a stable error even if a proxy returned a non-JSON response.
      }
      throw new GridStoryApiError(
        envelope.error?.message ?? `GridStory request failed with status ${response.status}.`,
        {
          status: response.status,
          ...(envelope.error?.code ? { code: envelope.error.code } : {}),
          ...(envelope.error?.details !== undefined ? { details: envelope.error.details } : {}),
          ...(envelope.error?.requestId ? { requestId: envelope.error.requestId } : {}),
        },
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async #previewRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
    if (!response.ok) {
      let envelope: GridStoryErrorEnvelope = {};
      try {
        envelope = (await response.json()) as GridStoryErrorEnvelope;
      } catch {
        // Preview responses retain the same stable error shape through proxies.
      }
      throw new GridStoryApiError(
        envelope.error?.message ??
          `GridStory preview request failed with status ${response.status}.`,
        {
          status: response.status,
          ...(envelope.error?.code ? { code: envelope.error.code } : {}),
          ...(envelope.error?.details !== undefined ? { details: envelope.error.details } : {}),
          ...(envelope.error?.requestId ? { requestId: envelope.error.requestId } : {}),
        },
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  getSchemas(signal?: AbortSignal): Promise<ContentSchemaDefinition[]> {
    return this.#request('/api/v1/schemas', { ...(signal ? { signal } : {}) });
  }

  getRequestContext(signal?: AbortSignal): Promise<RequestContext> {
    return this.#request('/api/v1/context', { ...(signal ? { signal } : {}) });
  }

  getIdentity(signal?: AbortSignal): Promise<IdentitySnapshot> {
    return this.#request('/api/v1/identity', { ...(signal ? { signal } : {}) });
  }

  configureIdentityProvider(
    input: Omit<IdentityProvider, 'organizationId' | 'tenantId' | 'createdAt' | 'updatedAt'>,
    signal?: AbortSignal,
  ): Promise<IdentityProvider> {
    return this.#request('/api/v1/identity/providers', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  updateSessionPolicy(policy: SessionPolicy, signal?: AbortSignal): Promise<SessionPolicy> {
    return this.#request('/api/v1/identity/session-policy', {
      method: 'PUT',
      body: JSON.stringify(policy),
      ...(signal ? { signal } : {}),
    });
  }

  createGroupRoleMapping(
    input: Omit<GroupRoleMapping, 'organizationId' | 'tenantId' | 'createdAt' | 'updatedAt'>,
    signal?: AbortSignal,
  ): Promise<GroupRoleMapping> {
    return this.#request('/api/v1/identity/group-role-mappings', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  deleteGroupRoleMapping(id: string, signal?: AbortSignal): Promise<void> {
    return this.#request(`/api/v1/identity/group-role-mappings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      ...(signal ? { signal } : {}),
    });
  }

  issueDirectoryCredential(
    name: string,
    signal?: AbortSignal,
  ): Promise<{ id: string; token: string; expiresAt: string }> {
    return this.#request('/api/v1/identity/directory-credentials', {
      method: 'POST',
      body: JSON.stringify({ name }),
      ...(signal ? { signal } : {}),
    });
  }

  createBreakGlassCredential(input: {
    name: string;
    roleId: string;
    expiresAt: string;
    incidentId: string;
    signal?: AbortSignal;
  }): Promise<{ id: string; token: string; expiresAt: string }> {
    return this.#request('/api/v1/identity/break-glass', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        roleId: input.roleId,
        expiresAt: input.expiresAt,
        incidentId: input.incidentId,
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  revokeBreakGlassCredential(id: string, incidentId: string, signal?: AbortSignal): Promise<void> {
    return this.#request(`/api/v1/identity/break-glass/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ incidentId }),
      ...(signal ? { signal } : {}),
    });
  }

  getIdentitySession(signal?: AbortSignal): Promise<{
    session: IdentitySession;
    principal: RequestContext['principal'];
  }> {
    return this.#request('/api/v1/identity/session', { ...(signal ? { signal } : {}) });
  }

  logoutIdentitySession(signal?: AbortSignal): Promise<void> {
    return this.#request('/api/v1/identity/session', {
      method: 'DELETE',
      ...(signal ? { signal } : {}),
    });
  }

  federationStartUrl(providerId: string): string {
    const query = new URLSearchParams({
      organizationId: this.#scope.organizationId,
      tenantId: this.#tenantId,
    });
    return `${this.#baseUrl}/api/v1/identity/federation/${encodeURIComponent(providerId)}/start?${query}`;
  }

  getGovernance(signal?: AbortSignal): Promise<GovernanceSnapshot> {
    return this.#request('/api/v1/governance', { ...(signal ? { signal } : {}) });
  }

  saveGovernancePolicy(
    input: GovernancePolicyInput,
    signal?: AbortSignal,
  ): Promise<GovernanceSnapshot> {
    return this.#request('/api/v1/governance/policy', {
      method: 'PUT',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  createDataSubject(reference: string, signal?: AbortSignal): Promise<DataSubject> {
    return this.#request('/api/v1/governance/subjects', {
      method: 'POST',
      body: JSON.stringify({ reference }),
      ...(signal ? { signal } : {}),
    });
  }

  linkDataSubjectResource(
    subjectId: string,
    input: Omit<SubjectResourceLink, 'id' | 'subjectId' | 'createdBy' | 'createdAt'>,
    signal?: AbortSignal,
  ): Promise<SubjectResourceLink> {
    return this.#request(`/api/v1/governance/subjects/${encodeURIComponent(subjectId)}/links`, {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  createLegalHold(
    input: Omit<
      LegalHold,
      'id' | 'status' | 'createdBy' | 'createdAt' | 'releasedBy' | 'releasedAt' | 'releaseReason'
    >,
    signal?: AbortSignal,
  ): Promise<LegalHold> {
    return this.#request('/api/v1/governance/holds', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  releaseLegalHold(id: string, reason: string, signal?: AbortSignal): Promise<LegalHold> {
    return this.#request(`/api/v1/governance/holds/${encodeURIComponent(id)}/release`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      ...(signal ? { signal } : {}),
    });
  }

  createDataSubjectRequest(
    input: Pick<DataSubjectRequest, 'subjectId' | 'type' | 'reason'>,
    signal?: AbortSignal,
  ): Promise<DataSubjectRequest> {
    return this.#request('/api/v1/governance/requests', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  verifyDataSubjectRequest(
    id: string,
    input: {
      method: 'customer-process' | 'federated-session' | 'manual-review';
      evidenceReference: string;
    },
    signal?: AbortSignal,
  ): Promise<DataSubjectRequest> {
    return this.#request(`/api/v1/governance/requests/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  reviewDataSubjectRequest(
    id: string,
    input: { decision: 'approve' | 'reject'; reason: string },
    signal?: AbortSignal,
  ): Promise<DataSubjectRequest> {
    return this.#request(`/api/v1/governance/requests/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  createErasurePlan(requestId: string, signal?: AbortSignal): Promise<GovernancePlan> {
    return this.#request(`/api/v1/governance/requests/${encodeURIComponent(requestId)}/plan`, {
      method: 'POST',
      ...(signal ? { signal } : {}),
    });
  }

  createRetentionPlan(signal?: AbortSignal): Promise<GovernancePlan> {
    return this.#request('/api/v1/governance/retention/plans', {
      method: 'POST',
      ...(signal ? { signal } : {}),
    });
  }

  approveGovernancePlan(
    id: string,
    input: { digest: string; reason: string; backup: GovernanceBackupEvidence },
    signal?: AbortSignal,
  ): Promise<GovernancePlan> {
    return this.#request(`/api/v1/governance/plans/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  processGovernancePlans(
    signal?: AbortSignal,
  ): Promise<{ claimed: number; completed: number; blocked: number; failed: number }> {
    return this.#request('/api/v1/governance/plans/process', {
      method: 'POST',
      ...(signal ? { signal } : {}),
    });
  }

  exportDataSubjectRequest(
    id: string,
    encrypt = true,
    signal?: AbortSignal,
  ): Promise<GovernanceExportEnvelope | GovernanceExportPackage> {
    return this.#request(`/api/v1/governance/requests/${encodeURIComponent(id)}/export`, {
      method: 'POST',
      body: JSON.stringify({ encrypt }),
      ...(signal ? { signal } : {}),
    });
  }

  getResidencyStatus(signal?: AbortSignal): Promise<ResidencyStatus> {
    return this.#request('/api/v1/governance/residency', { ...(signal ? { signal } : {}) });
  }

  getMigrations(signal?: AbortSignal): Promise<MigrationOverviewRecord> {
    return this.#request('/api/v1/migrations', { ...(signal ? { signal } : {}) });
  }

  saveMigrationRecipe(input: MigrationRecipeInput, signal?: AbortSignal): Promise<MigrationRecipe> {
    const { id, ...body } = input;
    return this.#request(`/api/v1/migrations/recipes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  }

  createMigrationProject(
    input: MigrationProjectInput,
    signal?: AbortSignal,
  ): Promise<MigrationProjectSummary> {
    return this.#request('/api/v1/migrations/projects', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  setMigrationProjectState(
    id: string,
    state: 'active' | 'paused',
    signal?: AbortSignal,
  ): Promise<MigrationProjectSummary> {
    return this.#request(`/api/v1/migrations/projects/${encodeURIComponent(id)}/state`, {
      method: 'POST',
      body: JSON.stringify({ state }),
      ...(signal ? { signal } : {}),
    });
  }

  createMigrationPlan(id: string, signal?: AbortSignal): Promise<MigrationPlanSummary> {
    return this.#request(`/api/v1/migrations/projects/${encodeURIComponent(id)}/plans`, {
      method: 'POST',
      ...(signal ? { signal } : {}),
    });
  }

  executeMigrationPlan(id: string, digest: string, signal?: AbortSignal): Promise<MigrationRun> {
    return this.#request(`/api/v1/migrations/plans/${encodeURIComponent(id)}/execute`, {
      method: 'POST',
      body: JSON.stringify({ digest }),
      ...(signal ? { signal } : {}),
    });
  }

  validateMigrationCutover(id: string, signal?: AbortSignal): Promise<MigrationCutoverReport> {
    return this.#request(`/api/v1/migrations/projects/${encodeURIComponent(id)}/cutover-reports`, {
      method: 'POST',
      ...(signal ? { signal } : {}),
    });
  }

  getMarketplace(signal?: AbortSignal): Promise<MarketplaceOverview> {
    return this.#request('/api/v1/marketplace', { ...(signal ? { signal } : {}) });
  }

  registerMarketplacePublisher(
    input: MarketplacePublisherInput,
    signal?: AbortSignal,
  ): Promise<MarketplacePublisherSummary> {
    return this.#request('/api/v1/marketplace/publishers', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  issueMarketplacePublisherChallenge(
    id: string,
    signal?: AbortSignal,
  ): Promise<MarketplaceDomainChallenge> {
    return this.#request(`/api/v1/marketplace/publishers/${encodeURIComponent(id)}/challenge`, {
      method: 'POST',
      body: JSON.stringify({}),
      ...(signal ? { signal } : {}),
    });
  }

  verifyMarketplacePublisherDomain(
    id: string,
    signal?: AbortSignal,
  ): Promise<MarketplacePublisherSummary> {
    return this.#request(`/api/v1/marketplace/publishers/${encodeURIComponent(id)}/verify-domain`, {
      method: 'POST',
      body: JSON.stringify({}),
      ...(signal ? { signal } : {}),
    });
  }

  approveMarketplacePublisher(
    id: string,
    input: ApproveMarketplacePublisherInput,
  ): Promise<MarketplacePublisherSummary> {
    return this.#request(`/api/v1/marketplace/publishers/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        evidenceReference: input.evidenceReference,
        reason: input.reason,
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  suspendMarketplacePublisher(
    id: string,
    reason: string,
    signal?: AbortSignal,
  ): Promise<MarketplacePublisherSummary> {
    return this.#request(`/api/v1/marketplace/publishers/${encodeURIComponent(id)}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      ...(signal ? { signal } : {}),
    });
  }

  submitMarketplaceRelease(
    submission: MarketplaceReleaseSubmission,
    signal?: AbortSignal,
  ): Promise<MarketplaceReleaseSummary> {
    return this.#request('/api/v1/marketplace/releases', {
      method: 'POST',
      body: JSON.stringify(submission),
      ...(signal ? { signal } : {}),
    });
  }

  reviewMarketplaceRelease(id: string, signal?: AbortSignal): Promise<MarketplaceReleaseSummary> {
    return this.#request(`/api/v1/marketplace/releases/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: JSON.stringify({}),
      ...(signal ? { signal } : {}),
    });
  }

  decideMarketplaceRelease(
    id: string,
    decision: 'approve' | 'reject' | 'yank',
    reason: string,
    signal?: AbortSignal,
  ): Promise<MarketplaceReleaseSummary> {
    return this.#request(`/api/v1/marketplace/releases/${encodeURIComponent(id)}/${decision}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      ...(signal ? { signal } : {}),
    });
  }

  installMarketplaceRelease(input: InstallMarketplaceReleaseInput): Promise<PluginInstallation> {
    return this.#request(
      `/api/v1/marketplace/releases/${encodeURIComponent(input.releaseId)}/install`,
      {
        method: 'POST',
        body: JSON.stringify({
          grantedCapabilities: input.grantedCapabilities,
          reason: input.reason,
        }),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
  }

  getPersonalization(signal?: AbortSignal): Promise<PersonalizationSnapshot> {
    return this.#request('/api/v1/personalization', { ...(signal ? { signal } : {}) });
  }

  replacePersonalizationDraft(
    input: {
      expectedVersion: number;
      configuration: PersonalizationConfiguration;
    },
    signal?: AbortSignal,
  ): Promise<PersonalizationSnapshot> {
    return this.#request('/api/v1/personalization/draft', {
      method: 'PUT',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  publishPersonalization(
    input: { expectedVersion: number; expectedDraftRevision: number },
    signal?: AbortSignal,
  ): Promise<PersonalizationSnapshot> {
    return this.#request('/api/v1/personalization/publish', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  previewPersonalization(
    input: PersonalizationPreviewRequest,
    signal?: AbortSignal,
  ): Promise<PersonalizationPreviewResult> {
    return this.#request('/api/v1/personalization/preview', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  decidePersonalization(
    input: PersonalizationDecisionRequest,
    signal?: AbortSignal,
  ): Promise<PersonalizationDecisionResult> {
    return this.#request('/api/v1/personalization/decide', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  getExperiments(signal?: AbortSignal): Promise<ExperimentOverview> {
    return this.#request('/api/v1/experiments', { ...(signal ? { signal } : {}) });
  }

  saveExperimentDraft(
    experimentId: string,
    input: { expectedVersion: number; design: ExperimentDesign },
    signal?: AbortSignal,
  ): Promise<ExperimentOverview> {
    return this.#request(`/api/v1/experiments/${encodeURIComponent(experimentId)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  transitionExperiment(
    experimentId: string,
    input: ExperimentTransitionRequest,
    signal?: AbortSignal,
  ): Promise<ExperimentOverview> {
    return this.#request(`/api/v1/experiments/${encodeURIComponent(experimentId)}/transition`, {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  recordExperimentMetrics(
    experimentId: string,
    input: { expectedVersion: number; snapshot: ExperimentMetricSnapshotInput },
    signal?: AbortSignal,
  ): Promise<ExperimentOverview> {
    return this.#request(`/api/v1/experiments/${encodeURIComponent(experimentId)}/metrics`, {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  promoteExperimentWinner(
    experimentId: string,
    input: ExperimentPromotionRequest,
    signal?: AbortSignal,
  ): Promise<ExperimentOverview> {
    return this.#request(`/api/v1/experiments/${encodeURIComponent(experimentId)}/promote`, {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  allocateExperiment(
    experimentId: string,
    input: ExperimentAllocationRequest,
    signal?: AbortSignal,
  ): Promise<ExperimentAllocationResult> {
    return this.#request(`/api/v1/experiments/${encodeURIComponent(experimentId)}/allocate`, {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  getComponentManifests(signal?: AbortSignal): Promise<ResolvedComponentManifest[]> {
    return this.#request('/api/v1/components', { ...(signal ? { signal } : {}) });
  }
  getComponentUsage(componentId: string, signal?: AbortSignal): Promise<ComponentUsageReport> {
    return this.#request(`/api/v1/components/${encodeURIComponent(componentId)}/usage`, {
      ...(signal ? { signal } : {}),
    });
  }

  getComponentMigration(
    componentId: string,
    signal?: AbortSignal,
  ): Promise<ComponentMigrationPlanResponse> {
    return this.#request(`/api/v1/components/${encodeURIComponent(componentId)}/migration`, {
      ...(signal ? { signal } : {}),
    });
  }

  getComponentVisualRegression(
    componentId: string,
    signal?: AbortSignal,
  ): Promise<ComponentVisualRegressionPlan> {
    return this.#request(
      `/api/v1/components/${encodeURIComponent(componentId)}/visual-regression`,
      { ...(signal ? { signal } : {}) },
    );
  }

  migrateEntryComponent(
    entryId: string,
    componentId: string,
    expectedRevisionId: string,
    signal?: AbortSignal,
  ): Promise<ComponentMigrationResult> {
    return this.#request(
      `/api/v1/content/${encodeURIComponent(entryId)}/components/${encodeURIComponent(componentId)}/migrate`,
      {
        method: 'POST',
        body: JSON.stringify({ expectedRevisionId }),
        ...(signal ? { signal } : {}),
      },
    );
  }

  listAssets(signal?: AbortSignal): Promise<AssetRecord[]> {
    return this.#request('/api/v1/assets', { ...(signal ? { signal } : {}) });
  }

  getAsset(id: string, signal?: AbortSignal): Promise<AssetRecord> {
    return this.#request(`/api/v1/assets/${encodeURIComponent(id)}`, {
      ...(signal ? { signal } : {}),
    });
  }

  async createAssetDelivery(
    id: string,
    input: CreateAssetDeliveryInput = {},
    signal?: AbortSignal,
  ): Promise<AssetDeliveryGrant> {
    const grant = await this.#request<AssetDeliveryGrant>(
      `/api/v1/assets/${encodeURIComponent(id)}/delivery`,
      {
        method: 'POST',
        body: JSON.stringify(input),
        ...(signal ? { signal } : {}),
      },
    );
    return {
      ...grant,
      url: new URL(grant.url, `${this.#baseUrl}/`).toString(),
    };
  }
  startAssetUpload(
    input: StartAssetUploadInput,
    signal?: AbortSignal,
  ): Promise<AssetUploadSession> {
    return this.#request('/api/v1/assets/uploads', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  getAssetUpload(id: string, signal?: AbortSignal): Promise<AssetUploadSession> {
    return this.#request(`/api/v1/assets/uploads/${encodeURIComponent(id)}`, {
      ...(signal ? { signal } : {}),
    });
  }

  uploadAssetPart(
    uploadId: string,
    partNumber: number,
    body: Uint8Array,
    signal?: AbortSignal,
  ): Promise<AssetUploadPart> {
    const payload = new ArrayBuffer(body.byteLength);
    new Uint8Array(payload).set(body);
    return this.#request(
      `/api/v1/assets/uploads/${encodeURIComponent(uploadId)}/parts/${partNumber}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: payload,
        ...(signal ? { signal } : {}),
      },
    );
  }

  completeAssetUpload(
    uploadId: string,
    parts: AssetUploadPart[],
    signal?: AbortSignal,
  ): Promise<AssetRecord> {
    return this.#request(`/api/v1/assets/uploads/${encodeURIComponent(uploadId)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ parts }),
      ...(signal ? { signal } : {}),
    });
  }

  abortAssetUpload(uploadId: string, signal?: AbortSignal): Promise<void> {
    return this.#request(`/api/v1/assets/uploads/${encodeURIComponent(uploadId)}`, {
      method: 'DELETE',
      ...(signal ? { signal } : {}),
    });
  }

  updateAsset(id: string, input: UpdateAssetInput, signal?: AbortSignal): Promise<AssetRecord> {
    return this.#request(`/api/v1/assets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  createAssetRendition(
    id: string,
    preset: AssetRenditionPreset,
    signal?: AbortSignal,
  ): Promise<AssetRendition> {
    return this.#request(`/api/v1/assets/${encodeURIComponent(id)}/renditions`, {
      method: 'POST',
      body: JSON.stringify(preset),
      ...(signal ? { signal } : {}),
    });
  }

  getAssetUsage(id: string, signal?: AbortSignal): Promise<AssetUsageReport> {
    return this.#request(`/api/v1/assets/${encodeURIComponent(id)}/usage`, {
      ...(signal ? { signal } : {}),
    });
  }

  getDesignSystem(signal?: AbortSignal): Promise<DesignSystemManifest> {
    return this.#request('/api/v1/design-system', { ...(signal ? { signal } : {}) });
  }

  createPreviewSession(input: CreatePreviewSessionInput): Promise<PreviewSessionGrant> {
    return this.#request('/api/v1/preview/sessions', {
      method: 'POST',
      body: JSON.stringify({
        previewUrl: input.previewUrl,
        route: input.route,
        mode: input.mode,
        ...(input.entryId ? { entryId: input.entryId } : {}),
        ...(input.ttlSeconds !== undefined ? { ttlSeconds: input.ttlSeconds } : {}),
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  getPreviewContent(id: string, token: string, signal?: AbortSignal): Promise<ContentEntry> {
    return this.#previewRequest(`/api/v1/preview/content/${encodeURIComponent(id)}`, token, {
      ...(signal ? { signal } : {}),
    });
  }

  acceptPreviewMessage(
    sessionId: string,
    token: string,
    message: PreviewMessage,
    signal?: AbortSignal,
  ): Promise<{ accepted: true; sequence: number }> {
    return this.#previewRequest(
      `/api/v1/preview/sessions/${encodeURIComponent(sessionId)}/messages`,
      token,
      {
        method: 'POST',
        body: JSON.stringify(message),
        ...(signal ? { signal } : {}),
      },
    );
  }

  revokePreviewSession(sessionId: string, token?: string, signal?: AbortSignal): Promise<void> {
    const path = `/api/v1/preview/sessions/${encodeURIComponent(sessionId)}`;
    if (token) {
      return this.#previewRequest(path, token, {
        method: 'DELETE',
        ...(signal ? { signal } : {}),
      });
    }
    return this.#request(path, { method: 'DELETE', ...(signal ? { signal } : {}) });
  }

  getSchemaLifecycle(signal?: AbortSignal): Promise<SchemaLifecycleInspection> {
    return this.#request('/api/v1/schema-lifecycle', { ...(signal ? { signal } : {}) });
  }

  getSchemaDrift(signal?: AbortSignal): Promise<SchemaDriftReport> {
    return this.#request('/api/v1/schema-lifecycle/drift', {
      ...(signal ? { signal } : {}),
    });
  }

  planSchema(
    candidate?: SchemaIrDocument | VisualModelDocument,
    signal?: AbortSignal,
  ): Promise<SchemaMigrationAssessmentResponse> {
    return this.#request('/api/v1/schema-lifecycle/plan', {
      method: 'POST',
      body: JSON.stringify({ ...(candidate ? { candidate } : {}) }),
      ...(signal ? { signal } : {}),
    });
  }

  deploySchema(
    options: { expectedPlanId?: string; approved?: boolean; signal?: AbortSignal } = {},
  ): Promise<SchemaDeploymentRecord> {
    return this.#request('/api/v1/schema-lifecycle/deploy', {
      method: 'POST',
      body: JSON.stringify({
        ...(options.expectedPlanId ? { expectedPlanId: options.expectedPlanId } : {}),
        ...(options.approved !== undefined ? { approved: options.approved } : {}),
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  listWorkflows(signal?: AbortSignal): Promise<WorkflowDefinition[]> {
    return this.#request('/api/v1/workflows', signal ? { signal } : {});
  }

  saveWorkflow(
    id: string,
    definition: WorkflowDefinitionInput,
    signal?: AbortSignal,
  ): Promise<WorkflowDefinition> {
    return this.#request(`/api/v1/workflows/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(definition),
      ...(signal ? { signal } : {}),
    });
  }

  getContentWorkflow(entryId: string, signal?: AbortSignal): Promise<WorkflowInstance> {
    return this.#request(
      `/api/v1/content/${encodeURIComponent(entryId)}/workflow`,
      signal ? { signal } : {},
    );
  }

  requestWorkflowTransition(
    entryId: string,
    transitionId: string,
    changedFields: string[] = [],
    signal?: AbortSignal,
  ): Promise<WorkflowInstance> {
    return this.#request(
      `/api/v1/content/${encodeURIComponent(entryId)}/workflow/transitions/${encodeURIComponent(transitionId)}`,
      {
        method: 'POST',
        body: JSON.stringify({ changedFields }),
        ...(signal ? { signal } : {}),
      },
    );
  }

  decideWorkflowApproval(
    entryId: string,
    requestId: string,
    decision: 'approved' | 'rejected',
    comment?: string,
    signal?: AbortSignal,
  ): Promise<WorkflowInstance> {
    return this.#request(
      `/api/v1/content/${encodeURIComponent(entryId)}/workflow/approvals/${encodeURIComponent(requestId)}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision, ...(comment ? { comment } : {}) }),
        ...(signal ? { signal } : {}),
      },
    );
  }

  scheduleWorkflowTransition(
    entryId: string,
    input: { transitionId: string; runAt: string; timeZone: string; signal?: AbortSignal },
  ): Promise<WorkflowInstance> {
    return this.#request(`/api/v1/content/${encodeURIComponent(entryId)}/workflow/schedules`, {
      method: 'POST',
      body: JSON.stringify({
        transitionId: input.transitionId,
        runAt: input.runAt,
        timeZone: input.timeZone,
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  cancelWorkflowSchedule(
    entryId: string,
    scheduleId: string,
    signal?: AbortSignal,
  ): Promise<WorkflowInstance> {
    return this.#request(
      `/api/v1/content/${encodeURIComponent(entryId)}/workflow/schedules/${encodeURIComponent(scheduleId)}`,
      { method: 'DELETE', ...(signal ? { signal } : {}) },
    );
  }

  processDueWorkflows(signal?: AbortSignal): Promise<{
    escalated: number;
    executed: number;
    failed: number;
  }> {
    return this.#request('/api/v1/workflows/process-due', {
      method: 'POST',
      body: JSON.stringify({}),
      ...(signal ? { signal } : {}),
    });
  }

  listWorkflowActions(signal?: AbortSignal): Promise<DurableJobRecord[]> {
    return this.#request('/api/v1/workflow-actions', signal ? { signal } : {});
  }

  drainWorkflowActions(limit = 25, signal?: AbortSignal): Promise<WorkflowActionDrainResult> {
    return this.#request('/api/v1/workflow-actions/drain', {
      method: 'POST',
      body: JSON.stringify({ limit }),
      ...(signal ? { signal } : {}),
    });
  }

  replayWorkflowAction(id: string, signal?: AbortSignal): Promise<DurableJobRecord> {
    return this.#request(`/api/v1/workflow-actions/${encodeURIComponent(id)}/replay`, {
      method: 'POST',
      body: JSON.stringify({}),
      ...(signal ? { signal } : {}),
    });
  }

  listPlugins(signal?: AbortSignal): Promise<PluginInstallation[]> {
    return this.#request('/api/v1/plugins', signal ? { signal } : {});
  }

  getPlugin(id: string, signal?: AbortSignal): Promise<PluginInstallation> {
    return this.#request(`/api/v1/plugins/${encodeURIComponent(id)}`, signal ? { signal } : {});
  }

  installPlugin(input: InstallPluginInput): Promise<PluginInstallation> {
    return this.#request('/api/v1/plugins/install', {
      method: 'POST',
      body: JSON.stringify({
        manifest: input.manifest,
        artifactDigest: input.artifactDigest,
        grantedCapabilities: input.grantedCapabilities,
        reason: input.reason,
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  enablePlugin(id: string, reason: string, signal?: AbortSignal): Promise<PluginInstallation> {
    return this.#pluginLifecycle(id, 'enable', reason, signal);
  }

  disablePlugin(id: string, reason: string, signal?: AbortSignal): Promise<PluginInstallation> {
    return this.#pluginLifecycle(id, 'disable', reason, signal);
  }

  revokePlugin(id: string, reason: string, signal?: AbortSignal): Promise<PluginInstallation> {
    return this.#pluginLifecycle(id, 'revoke', reason, signal);
  }

  previewPluginUninstall(id: string, signal?: AbortSignal): Promise<PluginUninstallPreview> {
    return this.#request(
      `/api/v1/plugins/${encodeURIComponent(id)}/uninstall-preview`,
      signal ? { signal } : {},
    );
  }

  uninstallPlugin(id: string, reason: string, signal?: AbortSignal): Promise<PluginInstallation> {
    return this.#request(`/api/v1/plugins/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
      ...(signal ? { signal } : {}),
    });
  }

  invokePlugin(
    id: string,
    operation: string,
    capability: PluginCapabilityName,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<PluginInvocationResult> {
    return this.#request(`/api/v1/plugins/${encodeURIComponent(id)}/invoke`, {
      method: 'POST',
      body: JSON.stringify({ operation, capability, input }),
      ...(signal ? { signal } : {}),
    });
  }

  #pluginLifecycle(
    id: string,
    action: 'enable' | 'disable' | 'revoke',
    reason: string,
    signal?: AbortSignal,
  ): Promise<PluginInstallation> {
    return this.#request(`/api/v1/plugins/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      ...(signal ? { signal } : {}),
    });
  }

  listReleases(signal?: AbortSignal): Promise<Release[]> {
    return this.#request('/api/v1/releases', signal ? { signal } : {});
  }

  createRelease(input: ReleaseInput, signal?: AbortSignal): Promise<Release> {
    return this.#request('/api/v1/releases', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  getRelease(id: string, signal?: AbortSignal): Promise<Release> {
    return this.#request(`/api/v1/releases/${encodeURIComponent(id)}`, signal ? { signal } : {});
  }

  validateRelease(id: string, channel?: string, signal?: AbortSignal): Promise<Release> {
    return this.#request(`/api/v1/releases/${encodeURIComponent(id)}/validate`, {
      method: 'POST',
      body: JSON.stringify({ ...(channel ? { channel } : {}) }),
      ...(signal ? { signal } : {}),
    });
  }

  previewRelease(id: string, signal?: AbortSignal): Promise<ReleasePreview> {
    return this.#request(
      `/api/v1/releases/${encodeURIComponent(id)}/preview`,
      signal ? { signal } : {},
    );
  }

  scheduleRelease(
    id: string,
    input: { runAt: string; timeZone: string; signal?: AbortSignal },
  ): Promise<Release> {
    return this.#request(`/api/v1/releases/${encodeURIComponent(id)}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ runAt: input.runAt, timeZone: input.timeZone }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  cancelReleaseSchedule(id: string, signal?: AbortSignal): Promise<Release> {
    return this.#request(`/api/v1/releases/${encodeURIComponent(id)}/schedule`, {
      method: 'DELETE',
      ...(signal ? { signal } : {}),
    });
  }

  executeRelease(id: string, channel?: string, signal?: AbortSignal): Promise<Release> {
    return this.#request(`/api/v1/releases/${encodeURIComponent(id)}/execute`, {
      method: 'POST',
      body: JSON.stringify({ ...(channel ? { channel } : {}) }),
      ...(signal ? { signal } : {}),
    });
  }

  rollbackRelease(id: string, reason: string, signal?: AbortSignal): Promise<Release> {
    return this.#request(`/api/v1/releases/${encodeURIComponent(id)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      ...(signal ? { signal } : {}),
    });
  }

  processDueReleases(signal?: AbortSignal): Promise<{ executed: number; failed: number }> {
    return this.#request('/api/v1/releases/process-due', {
      method: 'POST',
      body: JSON.stringify({}),
      ...(signal ? { signal } : {}),
    });
  }
  listContent(
    options: { contentType?: string; perspective?: ContentPerspective; signal?: AbortSignal } = {},
  ): Promise<ContentEntry[]> {
    const search = new URLSearchParams();
    if (options.contentType) search.set('contentType', options.contentType);
    if (options.perspective) search.set('perspective', options.perspective);
    const suffix = search.size > 0 ? `?${search}` : '';
    return this.#request(`/api/v1/content${suffix}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  search(query: SearchQuery = {}, signal?: AbortSignal): Promise<SearchResponse> {
    return this.#request('/api/v1/search', {
      method: 'POST',
      body: JSON.stringify(query),
      ...(signal ? { signal } : {}),
    });
  }

  listTaxonomies(signal?: AbortSignal): Promise<TaxonomyDefinition[]> {
    return this.#request('/api/v1/taxonomies', signal ? { signal } : {});
  }

  getSearchIndexStatus(signal?: AbortSignal): Promise<SearchIndexStatus> {
    return this.#request('/api/v1/search/index/status', signal ? { signal } : {});
  }

  rebuildSearchIndex(
    perspective: ContentPerspective = 'published',
    signal?: AbortSignal,
  ): Promise<DurableJobRecord> {
    return this.#request('/api/v1/search/index/rebuild', {
      method: 'POST',
      body: JSON.stringify({ perspective }),
      ...(signal ? { signal } : {}),
    });
  }

  listBacklinks(
    entryId: string,
    perspective: ContentPerspective = 'published',
    signal?: AbortSignal,
  ): Promise<BacklinkRecord[]> {
    const search = new URLSearchParams({ perspective });
    return this.#request(`/api/v1/content/${encodeURIComponent(entryId)}/backlinks?${search}`, {
      ...(signal ? { signal } : {}),
    });
  }

  listRelatedContent(
    entryId: string,
    options: {
      perspective?: ContentPerspective;
      limit?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<RelatedContentRecord[]> {
    const search = new URLSearchParams({ perspective: options.perspective ?? 'published' });
    if (options.limit !== undefined) search.set('limit', String(options.limit));
    return this.#request(`/api/v1/content/${encodeURIComponent(entryId)}/related?${search}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }
  queryContent(query: ContentQuery = {}, signal?: AbortSignal): Promise<ContentConnection> {
    return this.#request('/api/v1/content/query', {
      method: 'POST',
      body: JSON.stringify(query),
      ...(signal ? { signal } : {}),
    });
  }

  queryPublishedContent(
    query: Omit<ContentQuery, 'perspective'> = {},
    signal?: AbortSignal,
  ): Promise<ContentConnection> {
    return this.#request('/api/v1/delivery/query', {
      method: 'POST',
      body: JSON.stringify(query),
      ...(signal ? { signal } : {}),
    });
  }

  listLocales(signal?: AbortSignal): Promise<LocaleConfiguration[]> {
    return this.#request('/api/v1/locales', { ...(signal ? { signal } : {}) });
  }

  getTranslationCompleteness(
    sourceId: string,
    signal?: AbortSignal,
  ): Promise<TranslationCompletenessReport> {
    return this.#request(`/api/v1/content/${encodeURIComponent(sourceId)}/translations`, {
      ...(signal ? { signal } : {}),
    });
  }

  createTranslation(
    sourceId: string,
    locale: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ContentEntry> {
    return this.#request(`/api/v1/content/${encodeURIComponent(sourceId)}/translations`, {
      method: 'POST',
      body: JSON.stringify({ locale, data }),
      ...(signal ? { signal } : {}),
    });
  }

  getLocalizedContent(
    translationGroupId: string,
    options: { locale?: string; signal?: AbortSignal } = {},
  ): Promise<LocalizedContentResolution> {
    return this.#request(`/api/v1/delivery/localized/${encodeURIComponent(translationGroupId)}`, {
      ...(options.locale ? { headers: { 'x-gridstory-locale': options.locale } } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  getLocalizedRoute(
    path: string,
    options: { locale?: string; signal?: AbortSignal } = {},
  ): Promise<LocalizedContentResolution> {
    const encodedPath = path
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return this.#request(`/api/v1/delivery/localized-routes/${encodedPath}`, {
      ...(options.locale ? { headers: { 'x-gridstory-locale': options.locale } } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  listOutbox(limit = 100, signal?: AbortSignal): Promise<OutboxEventRecord[]> {
    return this.#request(`/api/v1/operations/outbox?limit=${limit}`, {
      ...(signal ? { signal } : {}),
    });
  }

  listJobs(limit = 100, signal?: AbortSignal): Promise<DurableJobRecord[]> {
    return this.#request(`/api/v1/operations/jobs?limit=${limit}`, {
      ...(signal ? { signal } : {}),
    });
  }

  listWebhooks(signal?: AbortSignal): Promise<WebhookSubscriptionRecord[]> {
    return this.#request('/api/v1/operations/webhooks', {
      ...(signal ? { signal } : {}),
    });
  }

  saveWebhook(
    input: {
      id?: string;
      url: string;
      eventTypes: ContentEventType[];
      active?: boolean;
    },
    signal?: AbortSignal,
  ): Promise<WebhookSubscriptionRecord> {
    const path = input.id
      ? `/api/v1/operations/webhooks/${encodeURIComponent(input.id)}`
      : '/api/v1/operations/webhooks';
    return this.#request(path, {
      method: input.id ? 'PUT' : 'POST',
      body: JSON.stringify({
        url: input.url,
        eventTypes: input.eventTypes,
        ...(input.active !== undefined ? { active: input.active } : {}),
      }),
      ...(signal ? { signal } : {}),
    });
  }

  deleteWebhook(id: string, signal?: AbortSignal): Promise<void> {
    return this.#request(`/api/v1/operations/webhooks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      ...(signal ? { signal } : {}),
    });
  }

  drainOperations(limit = 25, signal?: AbortSignal): Promise<OperationsDrainResult> {
    return this.#request('/api/v1/operations/drain', {
      method: 'POST',
      body: JSON.stringify({ limit }),
      ...(signal ? { signal } : {}),
    });
  }

  replayJob(id: string, signal?: AbortSignal): Promise<DurableJobRecord> {
    return this.#request(`/api/v1/operations/jobs/${encodeURIComponent(id)}/replay`, {
      method: 'POST',
      body: JSON.stringify({}),
      ...(signal ? { signal } : {}),
    });
  }

  exportContentArchive(signal?: AbortSignal): Promise<LogicalContentArchive> {
    return this.#request('/api/v1/portability/export', {
      ...(signal ? { signal } : {}),
    });
  }

  importContentArchive(
    archive: LogicalContentArchive,
    options: {
      dryRun?: boolean;
      conflictPolicy?: 'reject' | 'skip' | 'replace';
      allowSchemaMismatch?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<LogicalImportResult> {
    const search = new URLSearchParams();
    if (options.dryRun !== undefined) search.set('dryRun', String(options.dryRun));
    if (options.conflictPolicy) search.set('conflictPolicy', options.conflictPolicy);
    if (options.allowSchemaMismatch !== undefined) {
      search.set('allowSchemaMismatch', String(options.allowSchemaMismatch));
    }
    const suffix = search.size > 0 ? `?${search}` : '';
    return this.#request(`/api/v1/portability/import${suffix}`, {
      method: 'POST',
      body: JSON.stringify(archive),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  verifyAudit(signal?: AbortSignal): Promise<AuditVerificationRecord> {
    return this.#request('/api/v1/audit/verify', {
      ...(signal ? { signal } : {}),
    });
  }

  exportAudit(signal?: AbortSignal): Promise<AuditExportRecord> {
    return this.#request('/api/v1/audit/export', {
      ...(signal ? { signal } : {}),
    });
  }

  getOperationsDashboard(signal?: AbortSignal): Promise<OperationsDashboardRecord> {
    return this.#request('/api/v1/operations/summary', {
      ...(signal ? { signal } : {}),
    });
  }

  trackAnalyticsEvent(
    event: PublicAnalyticsEventInput,
    signal?: AbortSignal,
  ): Promise<AnalyticsIngestionResult> {
    return this.#request('/api/v1/analytics/events', {
      method: 'POST',
      body: JSON.stringify(event),
      ...(signal ? { signal } : {}),
    });
  }

  getAnalyticsReport(signal?: AbortSignal): Promise<AnalyticsReport> {
    return this.#request('/api/v1/analytics/report', {
      ...(signal ? { signal } : {}),
    });
  }

  getAiGateway(signal?: AbortSignal): Promise<AiGatewayDocument> {
    return this.#request('/api/v1/ai', { ...(signal ? { signal } : {}) });
  }

  updateAiGatewayPolicy(
    input: AiGatewayPolicyInput,
    signal?: AbortSignal,
  ): Promise<AiGatewayDocument> {
    return this.#request('/api/v1/ai/policy', {
      method: 'PUT',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  createAiPromptVersion(
    input: AiPromptVersionInput,
    signal?: AbortSignal,
  ): Promise<AiGatewayDocument> {
    return this.#request('/api/v1/ai/prompts', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  activateAiPrompt(
    promptId: string,
    version: number,
    expectedVersion: number,
    signal?: AbortSignal,
  ): Promise<AiGatewayDocument> {
    return this.#request(
      `/api/v1/ai/prompts/${encodeURIComponent(promptId)}/versions/${version}/activate`,
      {
        method: 'POST',
        body: JSON.stringify({ expectedVersion }),
        ...(signal ? { signal } : {}),
      },
    );
  }

  setAiGatewayState(input: AiGatewayStateInput, signal?: AbortSignal): Promise<AiGatewayDocument> {
    return this.#request('/api/v1/ai/kill-switch', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  generateAi(input: AiGenerateInput, signal?: AbortSignal): Promise<AiGenerateResult> {
    return this.#request('/api/v1/ai/generate', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  }

  getContent(
    id: string,
    options: { perspective?: ContentPerspective; signal?: AbortSignal } = {},
  ): Promise<ContentEntry> {
    const search = new URLSearchParams();
    if (options.perspective) search.set('perspective', options.perspective);
    const suffix = search.size > 0 ? `?${search}` : '';
    return this.#request(`/api/v1/content/${encodeURIComponent(id)}${suffix}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  getPublishedBySlug(
    contentType: string,
    slug: string,
    signal?: AbortSignal,
  ): Promise<ContentEntry> {
    return this.#request(
      `/api/v1/delivery/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}`,
      { ...(signal ? { signal } : {}) },
    );
  }

  createContent(
    contentType: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ContentEntry> {
    return this.#request('/api/v1/content', {
      method: 'POST',
      body: JSON.stringify({ contentType, data }),
      ...(signal ? { signal } : {}),
    });
  }

  saveDraft(
    id: string,
    expectedRevisionId: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ContentEntry> {
    return this.#request(`/api/v1/content/${encodeURIComponent(id)}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ expectedRevisionId, data }),
      ...(signal ? { signal } : {}),
    });
  }

  getContentQuality(
    id: string,
    options: { channel?: string; signal?: AbortSignal } = {},
  ): Promise<ContentQualityReport> {
    const search = new URLSearchParams();
    if (options.channel) search.set('channel', options.channel);
    const suffix = search.size > 0 ? `?${search}` : '';
    return this.#request(`/api/v1/content/${encodeURIComponent(id)}/quality${suffix}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  assessContentQuality(
    id: string,
    data: Record<string, unknown>,
    options: { channel?: string; signal?: AbortSignal } = {},
  ): Promise<ContentQualityReport> {
    const search = new URLSearchParams();
    if (options.channel) search.set('channel', options.channel);
    const suffix = search.size > 0 ? `?${search}` : '';
    return this.#request(`/api/v1/content/${encodeURIComponent(id)}/quality${suffix}`, {
      method: 'POST',
      body: JSON.stringify({ data }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }
  publish(
    id: string,
    expectedRevisionId: string,
    signal?: AbortSignal,
    channel = 'web',
  ): Promise<ContentEntry> {
    return this.#request(`/api/v1/content/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevisionId, channel }),
      ...(signal ? { signal } : {}),
    });
  }

  listRevisions(id: string, signal?: AbortSignal): Promise<ContentRevision[]> {
    return this.#request(`/api/v1/content/${encodeURIComponent(id)}/revisions`, {
      ...(signal ? { signal } : {}),
    });
  }
  getCollaboration(id: string, signal?: AbortSignal): Promise<CollaborationSnapshot> {
    return this.#request(`/api/v1/content/${encodeURIComponent(id)}/collaboration`, {
      ...(signal ? { signal } : {}),
    });
  }

  submitCollaborationOperation(
    entryId: string,
    input: SubmitCollaborationOperationInput,
  ): Promise<CollaborationOperation> {
    return this.#request(
      `/api/v1/content/${encodeURIComponent(entryId)}/collaboration/operations`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...(input.id ? { id: input.id } : {}),
          ...(input.branchId ? { branchId: input.branchId } : {}),
          ...(input.actorSequence ? { actorSequence: input.actorSequence } : {}),
          ...(input.dependencies ? { dependencies: input.dependencies } : {}),
          target: input.target,
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.value !== undefined ? { value: input.value } : {}),
        }),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
  }

  createCollaborationBranch(
    entryId: string,
    input: CreateCollaborationBranchInput,
  ): Promise<CollaborationBranch> {
    return this.#request(`/api/v1/content/${encodeURIComponent(entryId)}/collaboration/branches`, {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        ...(input.parentBranchId ? { parentBranchId: input.parentBranchId } : {}),
        ...(input.id ? { id: input.id } : {}),
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  createCollaborationSuggestion(
    entryId: string,
    input: CreateCollaborationSuggestionInput,
  ): Promise<CollaborationSuggestion> {
    return this.#request(
      `/api/v1/content/${encodeURIComponent(entryId)}/collaboration/suggestions`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...(input.branchId ? { branchId: input.branchId } : {}),
          target: input.target,
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.id ? { id: input.id } : {}),
        }),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
  }

  reviewCollaborationSuggestion(
    entryId: string,
    suggestionId: string,
    decision: 'accept' | 'reject',
    signal?: AbortSignal,
  ): Promise<CollaborationSuggestion> {
    return this.#request(
      `/api/v1/content/${encodeURIComponent(entryId)}/collaboration/suggestions/${encodeURIComponent(suggestionId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ decision }),
        ...(signal ? { signal } : {}),
      },
    );
  }

  mergeCollaborationBranch(
    entryId: string,
    sourceBranchId: string,
    targetBranchId = 'main',
    signal?: AbortSignal,
  ): Promise<CollaborationMerge> {
    return this.#request(`/api/v1/content/${encodeURIComponent(entryId)}/collaboration/merges`, {
      method: 'POST',
      body: JSON.stringify({ sourceBranchId, targetBranchId }),
      ...(signal ? { signal } : {}),
    });
  }

  resolveCollaborationConflict(
    entryId: string,
    conflictId: string,
    input: ResolveCollaborationConflictInput,
  ): Promise<CollaborationConflict> {
    return this.#request(
      `/api/v1/content/${encodeURIComponent(entryId)}/collaboration/conflicts/${encodeURIComponent(conflictId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          ...(input.operationId ? { operationId: input.operationId } : {}),
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.actorSequence ? { actorSequence: input.actorSequence } : {}),
        }),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
  }

  createCommentThread(id: string, input: CreateCommentThreadInput): Promise<CommentThread> {
    return this.#request(`/api/v1/content/${encodeURIComponent(id)}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        ...(input.target ? { target: input.target } : {}),
        body: input.body,
        ...(input.mentions ? { mentions: input.mentions } : {}),
        ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
        ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  replyToComment(
    entryId: string,
    threadId: string,
    body: string,
    mentions?: string[],
    signal?: AbortSignal,
  ): Promise<CommentThread> {
    return this.#request(
      `/api/v1/content/${encodeURIComponent(entryId)}/comments/${encodeURIComponent(threadId)}/replies`,
      {
        method: 'POST',
        body: JSON.stringify({ body, ...(mentions ? { mentions } : {}) }),
        ...(signal ? { signal } : {}),
      },
    );
  }

  updateCommentThread(
    entryId: string,
    threadId: string,
    input: UpdateCommentThreadInput,
  ): Promise<CommentThread> {
    return this.#request(
      `/api/v1/content/${encodeURIComponent(entryId)}/comments/${encodeURIComponent(threadId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
          ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
          ...(input.resolved !== undefined ? { resolved: input.resolved } : {}),
        }),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
  }

  heartbeatPresence(
    entryId: string,
    input: PresenceHeartbeatInput,
  ): Promise<PresenceParticipant[]> {
    return this.#request(`/api/v1/content/${encodeURIComponent(entryId)}/presence`, {
      method: 'PUT',
      body: JSON.stringify({
        displayName: input.displayName,
        ...(input.field ? { field: input.field } : {}),
        ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  leavePresence(entryId: string, signal?: AbortSignal): Promise<void> {
    return this.#request(`/api/v1/content/${encodeURIComponent(entryId)}/presence`, {
      method: 'DELETE',
      ...(signal ? { signal } : {}),
    });
  }
}

export function createGridStoryClient(options: GridStoryClientOptions): GridStoryClient {
  return new GridStoryClient(options);
}

export type {
  AiGatewayDocument,
  AiGatewayPolicyInput,
  AiGatewayStateInput,
  AiGenerateInput,
  AiGenerateResult,
  AiPromptVersionInput,
  AnalyticsIngestionResult,
  AnalyticsReport,
  AssetDeliveryGrant,
  AssetRecord,
  AssetRendition,
  AssetRenditionPreset,
  AssetUploadPart,
  AssetUploadSession,
  AssetUsageReport,
  BacklinkRecord,
  CollaborationBranch,
  CollaborationConflict,
  CollaborationMerge,
  CollaborationOperation,
  CollaborationOperationInput,
  CollaborationSnapshot,
  CollaborationSuggestion,
  CollaborationTarget,
  CommentThread,
  ComponentManifest,
  ContentConnection,
  ContentEntry,
  ContentFilter,
  ContentFilterOperator,
  ContentPerspective,
  ContentQualityReport,
  ContentQuery,
  ContentRevision,
  ContentSchemaDefinition,
  ContentSort,
  CreateAssetDeliveryInput,
  DataSubject,
  DataSubjectRequest,
  ExperimentAllocationRequest,
  ExperimentAllocationResult,
  ExperimentDesign,
  ExperimentMetricSnapshotInput,
  ExperimentOverview,
  ExperimentPromotionRequest,
  ExperimentTransitionRequest,
  GovernanceBackupEvidence,
  GovernanceExportEnvelope,
  GovernanceExportPackage,
  GovernancePlan,
  GovernancePolicyInput,
  GovernanceSnapshot,
  GroupRoleMapping,
  IdentityProvider,
  IdentitySession,
  IdentitySnapshot,
  LegalHold,
  LocaleConfiguration,
  LocalizedContentResolution,
  MigrationCutoverReport,
  MigrationPlanSummary,
  MigrationProjectInput,
  MigrationProjectSummary,
  MigrationRecipe,
  MigrationRecipeInput,
  MigrationRun,
  MigrationSourceDescriptor,
  PersonalizationConfiguration,
  PersonalizationDecisionRequest,
  PersonalizationDecisionResult,
  PersonalizationPreviewRequest,
  PersonalizationPreviewResult,
  PersonalizationSnapshot,
  PresenceParticipant,
  PreviewMessage,
  PreviewMode,
  PreviewSessionGrant,
  PublicAnalyticsEventInput,
  RelatedContentRecord,
  Release,
  ReleaseInput,
  ReleasePreview,
  ResidencyStatus,
  ResolvedComponentManifest,
  SchemaDriftReport,
  SchemaIrDocument,
  SchemaMigrationPlan,
  SearchIndexStatus,
  SearchQuery,
  SearchResponse,
  SessionPolicy,
  StartAssetUploadInput,
  SubjectResourceLink,
  TaxonomyDefinition,
  TranslationCompletenessReport,
  UpdateAssetInput,
  VisualModelDocument,
  WorkflowDefinition,
  WorkflowDefinitionInput,
  WorkflowInstance,
};
