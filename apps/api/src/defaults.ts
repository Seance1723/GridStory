import { defaultEditorialWorkflow } from '@gridstory/core';
import type { ContentQualityPolicy, WorkflowDefinitionInput } from '@gridstory/schema';

export const defaultPageQualityPolicies: ContentQualityPolicy[] = [
  {
    id: 'page-web-quality-v1',
    contentType: 'page',
    channels: ['web'],
    seo: { titleMinLength: 15, titleMaxLength: 60, requireCanonicalRoute: true },
    accessibility: {
      requireImageAlt: true,
      rejectGenericLinkText: true,
      enforceHeadingOrder: true,
      requireTableHeader: true,
    },
    links: { requirePublishedReferences: true, checkExternal: false },
    content: { minWords: 20, prohibitedPhrases: [] },
    gate: { blockedSeverities: ['error'], minimumScore: 50 },
  },
];

export const defaultWorkflowDefinitions: Array<{
  id: string;
  definition: WorkflowDefinitionInput;
}> = [
  { id: 'page-editorial', definition: defaultEditorialWorkflow() },
  {
    id: 'article-editorial',
    definition: {
      ...defaultEditorialWorkflow(),
      name: 'Article editorial review',
      contentType: 'article',
    },
  },
];
