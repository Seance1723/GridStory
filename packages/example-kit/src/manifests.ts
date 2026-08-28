import type { ComponentManifest } from '@gridstory/schema';
import { defineContentSchema, type ContentDataOf } from '@gridstory/schema/typegen';

export const pageSchema = defineContentSchema({
  id: 'page',
  version: 5,
  name: 'Page',
  description: 'A routed page composed from registered React components.',
  collection: 'pages',
  titleField: 'title',
  localization: { localizedFields: ['title', 'slug', 'story', 'blocks'] },
  route: { pattern: '/:slug', slugField: 'slug' },
  taxonomies: [
    {
      id: 'topics',
      name: 'Topics',
      hierarchical: true,
      terms: [
        { id: 'product', slug: 'product', label: 'Product' },
        { id: 'launches', slug: 'launches', label: 'Launches', parentId: 'product' },
        { id: 'engineering', slug: 'engineering', label: 'Engineering' },
        { id: 'accessibility', slug: 'accessibility', label: 'Accessibility' },
      ],
    },
  ],
  fields: [
    {
      id: 'page.title',
      name: 'title',
      label: 'Title',
      type: 'text',
      required: true,
      minLength: 1,
      maxLength: 120,
    },
    {
      id: 'page.slug',
      name: 'slug',
      label: 'Slug',
      type: 'slug',
      required: true,
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    },
    {
      id: 'page.story',
      name: 'story',
      label: 'Editorial story',
      type: 'rich-text',
      required: false,
      allowedBlocks: ['paragraph', 'heading', 'list', 'quote', 'code', 'embed', 'table'],
    },
    {
      id: 'page.social-image',
      name: 'socialImage',
      label: 'Social image',
      type: 'asset',
      accepts: ['image'],
      requiredAlt: true,
    },
    {
      id: 'page.related-pages',
      name: 'relatedPages',
      label: 'Related pages',
      type: 'relation',
      targets: ['page'],
      multiple: true,
      maximum: 3,
    },
    {
      id: 'page.topics',
      name: 'topics',
      label: 'Topics',
      type: 'taxonomy',
      taxonomy: 'topics',
      multiple: true,
    },
    {
      id: 'page.blocks',
      name: 'blocks',
      label: 'Page blocks',
      type: 'component-tree',
      required: true,
      minimum: 1,
      accepts: ['gridstory.hero', 'gridstory.rich-text', 'gridstory.callout', 'gridstory.stack'],
    },
  ],
});

export const articleSchema = defineContentSchema({
  id: 'article',
  version: 1,
  name: 'Article',
  description: 'A routed editorial article without application composition.',
  collection: 'articles',
  titleField: 'headline',
  localization: { localizedFields: ['headline', 'slug', 'summary', 'body'] },
  route: { pattern: '/articles/:slug', slugField: 'slug' },
  taxonomies: [
    {
      id: 'article-topics',
      name: 'Article topics',
      hierarchical: false,
      terms: [
        { id: 'product-news', slug: 'product-news', label: 'Product news' },
        { id: 'engineering-notes', slug: 'engineering-notes', label: 'Engineering notes' },
      ],
    },
  ],
  fields: [
    {
      id: 'article.headline',
      name: 'headline',
      label: 'Headline',
      type: 'text',
      required: true,
      minLength: 1,
      maxLength: 160,
    },
    {
      id: 'article.slug',
      name: 'slug',
      label: 'Slug',
      type: 'slug',
      required: true,
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    },
    {
      id: 'article.summary',
      name: 'summary',
      label: 'Summary',
      type: 'text',
      required: false,
      maxLength: 280,
    },
    {
      id: 'article.body',
      name: 'body',
      label: 'Article body',
      type: 'rich-text',
      required: true,
      allowedBlocks: ['paragraph', 'heading', 'list', 'quote', 'code', 'embed', 'table'],
    },
    {
      id: 'article.related-pages',
      name: 'relatedPages',
      label: 'Related pages',
      type: 'relation',
      targets: ['page'],
      multiple: true,
      maximum: 3,
    },
    {
      id: 'article.topics',
      name: 'topics',
      label: 'Topics',
      type: 'taxonomy',
      taxonomy: 'article-topics',
      multiple: true,
    },
    {
      id: 'article.featured',
      name: 'featured',
      label: 'Featured article',
      type: 'boolean',
    },
  ],
});

export const componentManifests = [
  {
    id: 'gridstory.hero',
    version: 1,
    name: 'Hero',
    description: 'A prominent page introduction.',
    category: 'Marketing',
    strictProps: true,
    status: 'active',
    migrations: [],
    visualRegression: {
      scenarios: [
        {
          id: 'default',
          name: 'Default desktop hero',
          props: {
            eyebrow: 'React-first content',
            heading: 'Your application stays yours.',
            body: 'A stable code-owned scenario for visual regression tooling.',
            tone: 'indigo',
          },
          viewport: { width: 1440, height: 900 },
        },
      ],
    },
    slots: [],
    props: [
      {
        id: 'gridstory.hero.eyebrow',
        name: 'eyebrow',
        label: 'Eyebrow',
        type: 'text',
        required: false,
        maxLength: 40,
      },
      {
        id: 'gridstory.hero.heading',
        name: 'heading',
        label: 'Heading',
        type: 'text',
        required: true,
        maxLength: 90,
      },
      {
        id: 'gridstory.hero.body',
        name: 'body',
        label: 'Body',
        type: 'textarea',
        required: true,
        maxLength: 320,
      },
      {
        id: 'gridstory.hero.tone',
        name: 'tone',
        label: 'Tone',
        type: 'enum',
        required: true,
        defaultValue: 'indigo',
        values: ['indigo', 'sunrise', 'forest'],
      },
    ],
  },
  {
    id: 'gridstory.rich-text',
    version: 1,
    name: 'Rich text',
    description: 'A readable text section for the initial vertical slice.',
    category: 'Content',
    strictProps: true,
    status: 'active',
    migrations: [],
    visualRegression: { scenarios: [] },
    slots: [],
    props: [
      {
        id: 'gridstory.rich-text.heading',
        name: 'heading',
        label: 'Heading',
        type: 'text',
        required: true,
        maxLength: 100,
      },
      {
        id: 'gridstory.rich-text.body',
        name: 'body',
        label: 'Body',
        type: 'textarea',
        required: true,
        maxLength: 2000,
      },
    ],
  },
  {
    id: 'gridstory.callout',
    version: 1,
    name: 'Callout',
    description: 'A compact highlighted message.',
    category: 'Content',
    strictProps: true,
    status: 'active',
    migrations: [],
    visualRegression: { scenarios: [] },
    slots: [],
    props: [
      {
        id: 'gridstory.callout.heading',
        name: 'heading',
        label: 'Heading',
        type: 'text',
        required: true,
        maxLength: 80,
      },
      {
        id: 'gridstory.callout.body',
        name: 'body',
        label: 'Body',
        type: 'textarea',
        required: true,
        maxLength: 400,
      },
      {
        id: 'gridstory.callout.tone',
        name: 'tone',
        label: 'Tone',
        type: 'enum',
        required: true,
        defaultValue: 'info',
        values: ['info', 'success', 'warning'],
      },
    ],
  },
  {
    id: 'gridstory.stack',
    version: 1,
    name: 'Stack',
    description: 'A layout container for safely nesting content components.',
    category: 'Layout',
    strictProps: true,
    status: 'active',
    migrations: [],
    visualRegression: { scenarios: [] },
    slots: [
      {
        id: 'gridstory.stack.content',
        name: 'content',
        label: 'Content',
        accepts: ['gridstory.hero', 'gridstory.rich-text', 'gridstory.callout'],
        min: 0,
        max: 6,
      },
    ],
    props: [
      {
        id: 'gridstory.stack.gap',
        name: 'gap',
        label: 'Spacing',
        type: 'enum',
        required: true,
        defaultValue: 'medium',
        values: ['small', 'medium', 'large'],
      },
      {
        id: 'gridstory.stack.surface',
        name: 'surface',
        label: 'Surface',
        type: 'enum',
        required: true,
        defaultValue: 'plain',
        values: ['plain', 'subtle', 'contrast'],
      },
    ],
  },
] satisfies ComponentManifest[];

export type PageContent = ContentDataOf<typeof pageSchema>;
export type ArticleContent = ContentDataOf<typeof articleSchema>;

export const welcomePage: PageContent = {
  title: 'Welcome to GridStory',
  slug: 'welcome',
  story: {
    version: 1,
    blocks: [
      {
        id: 'story-intro',
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Edit semantic blocks, connect references, and collaborate without changing application ownership.',
            marks: [],
          },
        ],
      },
    ],
  },
  relatedPages: [],
  topics: ['product'],
  blocks: [
    {
      id: 'welcome-hero',
      component: 'gridstory.hero',
      version: 1,
      props: {
        eyebrow: 'React-first content',
        heading: 'Your application stays yours.',
        body: 'GridStory lets developers own React components while editors safely compose and publish the experience.',
        tone: 'indigo',
      },
    },
    {
      id: 'welcome-rich-text',
      component: 'gridstory.rich-text',
      version: 1,
      props: {
        heading: 'The first vertical slice',
        body: 'This page is stored as immutable revisions, edited in GridStory Studio, previewed with the same React components, and delivered through the framework-neutral client.',
      },
    },
    {
      id: 'welcome-callout',
      component: 'gridstory.callout',
      version: 1,
      props: {
        heading: 'Portable by design',
        body: 'Content is plain structured data and the application controls production rendering.',
        tone: 'success',
      },
    },
  ],
};

export const welcomeArticle: ArticleContent = {
  headline: 'Introducing registered collections',
  slug: 'registered-collections',
  summary: 'One content engine can author routed pages and structured editorial collections.',
  body: {
    version: 1,
    blocks: [
      {
        id: 'article-intro',
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'This article uses its own registered fields and workflow without acquiring page composition or preview controls.',
            marks: [],
          },
        ],
      },
    ],
  },
  relatedPages: [],
  topics: ['product-news'],
  featured: true,
};
