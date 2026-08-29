import { GridStoryApiError, type GridStoryClient } from '@gridstory/client';
import type { StudioCapabilities, StudioOperation } from '@gridstory/schema';

// A finite UI adapter, not an authorization policy. The API still authorizes each request.
// Unknown SDK methods fail closed; adding a feature requires an explicit operation mapping.
export const studioMethodOperations = {
  getEditorialOverview: ['home.read'],
  listContent: ['content.read'],
  queryContent: ['content.read'],
  createContent: ['content.create'],
  getContent: ['content.read'],
  saveDraft: ['content.draft.update'],
  publish: ['content.publish'],
  listRevisions: ['content.history.read'],
  getContentQuality: ['quality.read'],
  assessContentQuality: ['quality.assess'],
  createPreviewSession: ['preview.manage'],
  revokePreviewSession: ['preview.manage'],
  getSchemas: ['schema.read'],
  getSchemaLifecycle: ['schema.read'],
  getSchemaDrift: ['schema.read'],
  planSchema: ['schema.plan'],
  getComponentManifests: ['component.read'],
  getDesignSystem: ['component.read'],
  getComponentMigration: ['component.read'],
  getComponentVisualRegression: ['component.read'],
  migrateEntryComponent: ['content.draft.update'],
  listAssets: ['asset.read'],
  getAsset: ['asset.read'],
  createAssetDelivery: ['asset.read'],
  getAssetUpload: ['asset.create'],
  getAssetUsage: ['asset.read'],
  startAssetUpload: ['asset.create'],
  uploadAssetPart: ['asset.create'],
  completeAssetUpload: ['asset.create'],
  abortAssetUpload: ['asset.create'],
  updateAsset: ['asset.update'],
  createAssetRendition: ['asset.update'],
  getCollaboration: ['collaboration.read'],
  heartbeatPresence: ['presence.write'],
  leavePresence: ['presence.write'],
  createCommentThread: ['collaboration.write'],
  replyToComment: ['collaboration.write'],
  updateCommentThread: ['collaboration.write'],
  submitCollaborationOperation: ['collaboration.write'],
  createCollaborationBranch: ['collaboration.write'],
  createCollaborationSuggestion: ['collaboration.write'],
  reviewCollaborationSuggestion: ['collaboration.write'],
  mergeCollaborationBranch: ['collaboration.write'],
  resolveCollaborationConflict: ['collaboration.write'],
  listWorkflows: ['workflow.read'],
  getContentWorkflow: ['workflow.read'],
  saveWorkflow: ['workflow.manage'],
  requestWorkflowTransition: ['workflow.transition'],
  decideWorkflowApproval: ['workflow.approve'],
  scheduleWorkflowTransition: ['workflow.schedule'],
  cancelWorkflowSchedule: ['workflow.schedule'],
  listWorkflowActions: ['workflow.action.read'],
  drainWorkflowActions: ['workflow.action.run'],
  replayWorkflowAction: ['workflow.action.replay'],
  listReleases: ['release.read'],
  createRelease: ['release.manage'],
  validateRelease: ['release.manage'],
  previewRelease: ['release.read'],
  scheduleRelease: ['release.schedule'],
  cancelReleaseSchedule: ['release.schedule'],
  executeRelease: ['release.execute'],
  rollbackRelease: ['release.rollback'],
  search: ['search.read'],
  listTaxonomies: ['search.read'],
  getSearchIndexStatus: ['search.read'],
  listBacklinks: ['search.related.read'],
  listRelatedContent: ['search.related.read'],
  rebuildSearchIndex: ['search.manage'],
  getOperationsDashboard: ['operations.read'],
  getAnalyticsReport: ['operations.read'],
  drainOperations: ['operations.run'],
  getIdentity: ['identity.manage'],
  configureIdentityProvider: ['identity.manage'],
  updateSessionPolicy: ['identity.manage'],
  createGroupRoleMapping: ['identity.manage'],
  issueDirectoryCredential: ['identity.manage'],
  createBreakGlassCredential: ['identity.manage'],
  getGovernance: ['governance.read'],
  createDataSubject: ['governance.manage'],
  createLegalHold: ['governance.manage'],
  createRetentionPlan: ['governance.manage'],
  approveGovernancePlan: ['governance.execute'],
  getMigrations: ['migration.read'],
  saveMigrationRecipe: ['migration.manage'],
  createMigrationProject: ['migration.manage'],
  setMigrationProjectState: ['migration.manage'],
  createMigrationPlan: ['migration.manage'],
  executeMigrationPlan: ['migration.execute'],
  validateMigrationCutover: ['migration.execute'],
  getMarketplace: ['marketplace.read'],
  registerMarketplacePublisher: ['marketplace.manage'],
  issueMarketplacePublisherChallenge: ['marketplace.manage'],
  verifyMarketplacePublisherDomain: ['marketplace.manage'],
  approveMarketplacePublisher: ['marketplace.review'],
  suspendMarketplacePublisher: ['marketplace.review'],
  submitMarketplaceRelease: ['marketplace.manage'],
  reviewMarketplaceRelease: ['marketplace.review'],
  decideMarketplaceRelease: ['marketplace.review'],
  installMarketplaceRelease: ['marketplace.read', 'plugin.manage'],
  getPersonalization: ['personalization.read'],
  replacePersonalizationDraft: ['personalization.manage'],
  publishPersonalization: ['personalization.manage'],
  previewPersonalization: ['personalization.preview'],
  getExperiments: ['experiment.read'],
  saveExperimentDraft: ['experiment.manage'],
  transitionExperiment: ['experiment.manage'],
  recordExperimentMetrics: ['experiment.metrics'],
  promoteExperimentWinner: ['experiment.promote'],
  getAiGateway: ['ai.read'],
  getAiAuthoring: ['ai.read'],
  updateAiGatewayPolicy: ['ai.manage'],
  updateAiAuthoringPolicy: ['ai.manage'],
  createAiPromptVersion: ['ai.manage'],
  activateAiPrompt: ['ai.manage'],
  setAiGatewayState: ['ai.manage'],
  generateAi: ['ai.execute'],
  createAiAuthoringProposal: ['ai.execute', 'content.read'],
  reviewAiAuthoringProposal: ['ai.review', 'content.read'],
  semanticAiSearch: ['ai.read'],
  getRegionalTopology: ['regional.read'],
  updateRegionalPolicy: ['regional.manage'],
  preflightRegionalFailover: ['regional.failover'],
  approveRegionalFailover: ['regional.failover'],
  executeRegionalFailover: ['regional.failover'],
  reconcileRegionalFailover: ['regional.failover'],
  getContentFederation: ['federation.read'],
  upsertFederationOffer: ['federation.manage'],
  inspectFederationAgreement: ['federation.manage'],
  setFederationAgreementState: ['federation.manage'],
  planFederationSync: ['federation.sync'],
  executeFederationSync: ['federation.sync'],
  exploreKnowledgeGraph: ['knowledge.read'],
  listKnowledgeRecommendations: ['knowledge.read'],
  getKnowledgeAgent: ['agent.read'],
  updateKnowledgeAgentPolicy: ['agent.manage'],
  createKnowledgeAgentPlan: ['agent.plan', 'content.read'],
  reviewKnowledgeAgentPlan: ['agent.review', 'content.read'],
  executeKnowledgeAgentPlan: ['agent.execute', 'content.draft.update'],
  getFleet: ['fleet.read'],
  upsertFleetMember: ['fleet.manage'],
  setFleetMemberState: ['fleet.manage'],
  removeFleetMember: ['fleet.manage'],
  checkFleetMember: ['fleet.check'],
} as const satisfies Partial<Record<keyof GridStoryClient, readonly StudioOperation[]>>;

export function studioClientOperations(
  method: string,
  args: readonly unknown[],
): readonly StudioOperation[] | undefined {
  if (method === 'listContent' || method === 'queryContent') {
    const contentType = (args[0] as { contentType?: unknown } | undefined)?.contentType;
    return contentType === 'page' ? ['pages.list'] : ['content.read'];
  }
  if (method === 'createContent') return args[0] === 'page' ? ['pages.create'] : ['content.create'];
  return studioMethodOperations[method as keyof typeof studioMethodOperations];
}

export function permits(
  capabilities: StudioCapabilities,
  ...operations: StudioOperation[]
): boolean {
  return operations.every((operation) => capabilities.operations[operation] === true);
}

export function staleStudioRequest(): DOMException {
  return new DOMException('Studio authority changed. Retry after checking access.', 'AbortError');
}

export function guardStudioClient(
  client: GridStoryClient,
  authority: () => { capabilities: StudioCapabilities; generation: number } | null,
  onDenied: (status: 401 | 403) => void,
): GridStoryClient {
  const methods = new Map<string, unknown>();
  return new Proxy(client, {
    get(target, property) {
      if (typeof property !== 'string') return undefined;
      if (methods.has(property)) return methods.get(property);
      const method = Reflect.get(target, property);
      if (typeof method !== 'function') return undefined;
      const guarded = async (...args: unknown[]) => {
        const lease = authority();
        if (!lease) throw staleStudioRequest();
        const operations = studioClientOperations(property, args);
        if (!operations || !permits(lease.capabilities, ...operations)) {
          throw new GridStoryApiError('This operation is not available with your current access.', {
            status: 403,
          });
        }
        try {
          const result: unknown = await Reflect.apply(Reflect.get(target, property), target, args);
          if (authority()?.generation !== lease.generation) {
            if (
              property === 'createPreviewSession' &&
              typeof result === 'object' &&
              result !== null &&
              'sessionId' in result &&
              typeof result.sessionId === 'string'
            ) {
              // Closing the popup is not enough: the server may issue a grant after
              // suspension. Best-effort cleanup must precede dropping this result.
              await client.revokePreviewSession(result.sessionId).catch(() => undefined);
            }
            throw staleStudioRequest();
          }
          return result;
        } catch (error) {
          // An old response (including an old 401) must never replace a newer session.
          if (authority()?.generation !== lease.generation) throw staleStudioRequest();
          if (
            error instanceof GridStoryApiError &&
            (error.status === 401 || error.status === 403)
          ) {
            onDenied(error.status);
            throw staleStudioRequest();
          }
          throw error;
        }
      };
      methods.set(property, guarded);
      return guarded;
    },
  });
}
