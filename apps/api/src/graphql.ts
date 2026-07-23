import mercurius, { type MercuriusContext } from 'mercurius';
import { GraphQLScalarType, Kind, valueFromASTUntyped, type ValueNode } from 'graphql';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  GridStoryActions,
  type AuthorizationPolicy,
  type ContentQueryService,
  type ContentService,
  type LocalizationService,
  type SchemaLifecycleService,
} from '@gridstory/core';
import {
  schemaIrDocumentSchema,
  visualModelDocumentSchema,
  visualModelToSchemaIr,
  type ContentPerspective,
  type ContentQuery,
  type SchemaIrDocument,
  type RequestContext,
} from '@gridstory/schema';
import { authorize, contentScope, requestContext } from './request-context.js';

const schema = /* GraphQL */ `
  scalar JSON

  enum ContentPerspective {
    draft
    published
  }

  enum ContentFilterOperator {
    eq
    ne
    in
    notIn
    contains
    startsWith
    endsWith
    gt
    gte
    lt
    lte
    exists
  }

  enum ContentSortDirection {
    asc
    desc
  }

  enum ContentNullsPlacement {
    first
    last
  }

  input ContentFilterInput {
    path: String
    operator: ContentFilterOperator
    value: JSON
    caseSensitive: Boolean
    and: [ContentFilterInput!]
    or: [ContentFilterInput!]
    not: ContentFilterInput
  }

  input ContentSortInput {
    path: String!
    direction: ContentSortDirection = asc
    nulls: ContentNullsPlacement = last
  }

  input ContentQueryInput {
    contentType: String
    perspective: ContentPerspective
    filter: ContentFilterInput
    sort: [ContentSortInput!]
    first: Int = 20
    after: String
    projection: [String!]
  }

  type ContentEntry {
    organizationId: String!
    tenantId: String!
    workspaceId: String!
    siteId: String!
    environmentId: String!
    locale: String!
    id: ID!
    contentType: String!
    status: String!
    draftRevisionId: ID!
    publishedRevisionId: ID
    createdAt: String!
    updatedAt: String!
    data: JSON!
  }

  type ContentEdge {
    cursor: String!
    node: ContentEntry!
  }

  type ContentPageInfo {
    startCursor: String
    endCursor: String
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
  }

  type ContentConnection {
    edges: [ContentEdge!]!
    nodes: [ContentEntry!]!
    pageInfo: ContentPageInfo!
    totalCount: Int!
  }

  type Query {
    content(id: ID!, perspective: ContentPerspective = draft): ContentEntry
    contents(query: ContentQueryInput = {}): ContentConnection!
    publishedContent(contentType: String!, slug: String!): ContentEntry
    publishedContents(query: ContentQueryInput = {}): ContentConnection!
    schemas: JSON!
    components: JSON!
    schemaLifecycle: JSON!
    schemaDrift: JSON!
    locales: JSON!
    localizedContent(translationGroupId: ID!, locale: String): JSON!
    translationCompleteness(id: ID!): JSON!
  }

  type Mutation {
    createContent(contentType: String!, data: JSON!): ContentEntry!
    updateDraft(id: ID!, expectedRevisionId: ID!, data: JSON!): ContentEntry!
    publishContent(id: ID!, expectedRevisionId: ID!): ContentEntry!
    planSchema(candidate: JSON): JSON!
    deploySchema(expectedPlanId: ID, approved: Boolean = false): JSON!
    createTranslation(sourceId: ID!, locale: String!, data: JSON!): ContentEntry!
  }
`;

declare module 'mercurius' {
  interface MercuriusContext {
    request: FastifyRequest;
  }
}

type GraphqlContext = MercuriusContext;

interface GraphqlServices {
  content: ContentService;
  queries: ContentQueryService;
  lifecycle: SchemaLifecycleService;
  policy: AuthorizationPolicy;
  localization: LocalizationService;
}

function jsonLiteral(ast: ValueNode): unknown {
  if (ast.kind === Kind.NULL) return null;
  return valueFromASTUntyped(ast);
}

const jsonScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'A JSON-compatible GridStory value.',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: jsonLiteral,
});

function selectedQuery(
  input: ContentQuery | undefined,
  perspective?: ContentPerspective,
): ContentQuery {
  return {
    ...(input?.contentType ? { contentType: input.contentType } : {}),
    ...((perspective ?? input?.perspective)
      ? { perspective: perspective ?? input?.perspective }
      : {}),
    ...(input?.filter ? { filter: input.filter } : {}),
    ...(input?.sort ? { sort: input.sort } : {}),
    ...(input?.first !== undefined ? { first: input.first } : {}),
    ...(input?.after ? { after: input.after } : {}),
    ...(input?.projection ? { projection: input.projection } : {}),
  } as ContentQuery;
}

function candidateDocument(value: unknown, fallback: SchemaIrDocument): SchemaIrDocument {
  if (value === undefined || value === null) return fallback;
  const canonical = schemaIrDocumentSchema.safeParse(value);
  if (canonical.success) return canonical.data;
  const visual = visualModelDocumentSchema.safeParse(value);
  if (visual.success) return visualModelToSchemaIr(visual.data);
  throw new Error('Candidate schema IR or visual model is invalid.');
}

export async function registerGridStoryGraphql(
  server: FastifyInstance,
  { content, queries, lifecycle, policy, localization }: GraphqlServices,
): Promise<void> {
  await server.register(mercurius, {
    schema,
    path: '/graphql',
    graphiql: false,
    ide: false,
    subscription: false,
    allowBatchedQueries: false,
    queryDepth: 12,
    context: (request) => ({ request }),
    resolvers: {
      JSON: jsonScalar,
      Query: {
        content: async (
          _root: unknown,
          args: { id: string; perspective?: ContentPerspective },
          graphql: GraphqlContext,
        ) => {
          const selectedPerspective = args.perspective ?? 'draft';
          const context = requestContext(graphql.request, selectedPerspective);
          authorize(policy, context, GridStoryActions.contentRead, {
            kind: 'content',
            id: args.id,
          });
          return content.get({
            scope: contentScope(context),
            id: args.id,
            perspective: selectedPerspective,
          });
        },
        contents: async (
          _root: unknown,
          args: { query?: ContentQuery },
          graphql: GraphqlContext,
        ) => {
          const query = selectedQuery(args.query);
          const selectedPerspective = query.perspective ?? 'draft';
          const context = requestContext(graphql.request, selectedPerspective);
          authorize(policy, context, GridStoryActions.contentRead, {
            kind: 'content',
            ...(query.contentType ? { contentType: query.contentType } : {}),
          });
          return queries.query(contentScope(context), query);
        },
        publishedContent: async (
          _root: unknown,
          args: { contentType: string; slug: string },
          graphql: GraphqlContext,
        ) => {
          const context = requestContext(graphql.request, 'published', true);
          authorize(policy, context, GridStoryActions.deliveryRead, {
            kind: 'delivery',
            contentType: args.contentType,
          });
          return content.getBySlug({
            scope: contentScope(context),
            contentType: args.contentType,
            slug: args.slug,
            perspective: 'published',
          });
        },
        publishedContents: async (
          _root: unknown,
          args: { query?: ContentQuery },
          graphql: GraphqlContext,
        ) => {
          const query = selectedQuery(args.query, 'published');
          const context = requestContext(graphql.request, 'published', true);
          authorize(policy, context, GridStoryActions.deliveryRead, {
            kind: 'delivery',
            ...(query.contentType ? { contentType: query.contentType } : {}),
          });
          return queries.query(contentScope(context), query);
        },
        schemas: (_root: unknown, _args: unknown, graphql: GraphqlContext) => {
          const context = requestContext(graphql.request, 'draft');
          authorize(policy, context, GridStoryActions.schemaRead, { kind: 'schema' });
          return content.getSchemas();
        },
        components: (_root: unknown, _args: unknown, graphql: GraphqlContext) => {
          const context = requestContext(graphql.request, 'draft');
          authorize(policy, context, GridStoryActions.componentRead, { kind: 'component' });
          return content.getComponentManifests();
        },
        schemaLifecycle: async (_root: unknown, _args: unknown, graphql: GraphqlContext) => {
          const context = requestContext(graphql.request, 'draft');
          authorize(policy, context, GridStoryActions.schemaRead, { kind: 'schema' });
          return {
            source: lifecycle.getSource(),
            generatedTypes: lifecycle.getGeneratedTypes(),
            deployment: await lifecycle.getDeployment(contentScope(context)),
          };
        },
        schemaDrift: async (_root: unknown, _args: unknown, graphql: GraphqlContext) => {
          const context = requestContext(graphql.request, 'draft');
          authorize(policy, context, GridStoryActions.schemaRead, { kind: 'schema' });
          return lifecycle.drift(contentScope(context));
        },
        locales: (_root: unknown, _args: unknown, graphql: GraphqlContext) => {
          const context = requestContext(graphql.request, 'draft');
          authorize(policy, context, GridStoryActions.contentRead, { kind: 'platform' });
          return localization.listLocales(context.siteId);
        },
        localizedContent: async (
          _root: unknown,
          args: { translationGroupId: string; locale?: string },
          graphql: GraphqlContext,
        ) => {
          const base = requestContext(graphql.request, 'published', true);
          const context: RequestContext = { ...base, locale: args.locale ?? base.locale };
          const result = await localization.resolve({
            scope: contentScope(context),
            translationGroupId: args.translationGroupId,
            perspective: 'published',
          });
          authorize(policy, context, GridStoryActions.deliveryRead, {
            kind: 'delivery',
            contentType: result.entry.contentType,
          });
          return result;
        },
        translationCompleteness: async (
          _root: unknown,
          args: { id: string },
          graphql: GraphqlContext,
        ) => {
          const context = requestContext(graphql.request, 'draft');
          const source = await content.get({ scope: contentScope(context), id: args.id });
          authorize(policy, context, GridStoryActions.contentRead, {
            kind: 'content',
            id: args.id,
            contentType: source.contentType,
          });
          return localization.completeness(contentScope(context), args.id);
        },
      },
      Mutation: {
        createContent: async (
          _root: unknown,
          args: { contentType: string; data: Record<string, unknown> },
          graphql: GraphqlContext,
        ) => {
          const context = requestContext(graphql.request, 'draft');
          authorize(policy, context, GridStoryActions.contentCreate, {
            kind: 'content',
            contentType: args.contentType,
          });
          return content.create({
            scope: contentScope(context),
            contentType: args.contentType,
            data: args.data,
            actor: { id: context.principal.id },
          });
        },
        updateDraft: async (
          _root: unknown,
          args: { id: string; expectedRevisionId: string; data: Record<string, unknown> },
          graphql: GraphqlContext,
        ) => {
          const context = requestContext(graphql.request, 'draft');
          authorize(policy, context, GridStoryActions.contentDraftUpdate, {
            kind: 'content',
            id: args.id,
          });
          return content.updateDraft({
            scope: contentScope(context),
            id: args.id,
            expectedRevisionId: args.expectedRevisionId,
            data: args.data,
            actor: { id: context.principal.id },
          });
        },
        publishContent: async (
          _root: unknown,
          args: { id: string; expectedRevisionId: string },
          graphql: GraphqlContext,
        ) => {
          const context = requestContext(graphql.request, 'draft');
          authorize(policy, context, GridStoryActions.contentPublish, {
            kind: 'content',
            id: args.id,
          });
          return content.publish({
            scope: contentScope(context),
            id: args.id,
            expectedRevisionId: args.expectedRevisionId,
            actor: { id: context.principal.id, roles: context.principal.roles },
          });
        },
        planSchema: async (
          _root: unknown,
          args: { candidate?: unknown },
          graphql: GraphqlContext,
        ) => {
          const context = requestContext(graphql.request, 'draft');
          authorize(policy, context, GridStoryActions.schemaPlan, { kind: 'schema' });
          return lifecycle.assess(
            contentScope(context),
            candidateDocument(args.candidate, lifecycle.getSource()),
          );
        },
        deploySchema: async (
          _root: unknown,
          args: { expectedPlanId?: string; approved?: boolean },
          graphql: GraphqlContext,
        ) => {
          const context = requestContext(graphql.request, 'draft');
          authorize(policy, context, GridStoryActions.schemaDeploy, { kind: 'schema' });
          return lifecycle.deploySource({
            scope: contentScope(context),
            actor: { id: context.principal.id },
            ...(args.expectedPlanId ? { expectedPlanId: args.expectedPlanId } : {}),
            approved: args.approved === true,
          });
        },
        createTranslation: async (
          _root: unknown,
          args: { sourceId: string; locale: string; data: Record<string, unknown> },
          graphql: GraphqlContext,
        ) => {
          const sourceContext = requestContext(graphql.request, 'draft');
          const source = await content.get({
            scope: contentScope(sourceContext),
            id: args.sourceId,
          });
          const targetContext: RequestContext = { ...sourceContext, locale: args.locale };
          authorize(policy, targetContext, GridStoryActions.contentCreate, {
            kind: 'content',
            contentType: source.contentType,
          });
          return localization.createTranslation({
            sourceScope: contentScope(sourceContext),
            sourceId: args.sourceId,
            locale: args.locale,
            data: args.data,
            actor: { id: sourceContext.principal.id },
          });
        },
      },
    },
  });
}
