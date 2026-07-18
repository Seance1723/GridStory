import type { DesignSystemManifest } from '@gridstory/schema';

export const exampleDesignSystem = {
  id: 'gridstory.example',
  version: 1,
  name: 'GridStory Example Design System',
  tokens: [
    {
      id: 'tone.brand',
      name: 'Brand tone',
      category: 'color',
      value: 'indigo',
      description: 'The primary application-owned Hero tone.',
    },
    {
      id: 'tone.positive',
      name: 'Positive tone',
      category: 'color',
      value: 'success',
      description: 'The approved positive Callout tone.',
    },
    {
      id: 'spacing.section',
      name: 'Section spacing',
      category: 'spacing',
      value: 'large',
      description: 'The roomy Stack spacing preset.',
    },
  ],
  breakpoints: [
    { id: 'mobile', name: 'Mobile', minWidth: 0 },
    { id: 'tablet', name: 'Tablet', minWidth: 768 },
    { id: 'desktop', name: 'Desktop', minWidth: 1200 },
  ],
  variants: [
    {
      id: 'hero.brand',
      name: 'Brand hero',
      component: 'gridstory.hero',
      description: 'Uses the application brand tone.',
      props: { tone: 'indigo' },
    },
    {
      id: 'hero.sunrise',
      name: 'Sunrise hero',
      component: 'gridstory.hero',
      description: 'Uses the warm campaign tone.',
      props: { tone: 'sunrise' },
    },
    {
      id: 'callout.positive',
      name: 'Positive callout',
      component: 'gridstory.callout',
      description: 'Uses the approved success treatment.',
      props: { tone: 'success' },
    },
  ],
  symbols: [
    {
      id: 'symbol.portability-callout',
      name: 'Portability callout',
      description: 'A governed reusable message with editable heading and body.',
      allowedPropOverrides: ['heading', 'body'],
      node: {
        id: 'symbol-portability-callout-source',
        component: 'gridstory.callout',
        version: 1,
        props: {
          heading: 'Portable by design',
          body: 'Structured content remains portable across React applications.',
          tone: 'success',
        },
        presentation: { designSystemVersion: 1, variantId: 'callout.positive' },
      },
    },
  ],
  templates: [
    {
      id: 'template.campaign-page',
      name: 'Campaign page',
      description: 'A Hero followed by a responsive content Stack.',
      category: 'Marketing',
      nodes: [
        {
          id: 'template-campaign-hero',
          component: 'gridstory.hero',
          version: 1,
          props: {
            eyebrow: 'Campaign',
            heading: 'Tell a compelling story.',
            body: 'Replace this template content with your campaign message.',
            tone: 'indigo',
          },
          presentation: {
            designSystemVersion: 1,
            variantId: 'hero.brand',
            responsive: {
              heading: {
                mobile: 'Tell your story.',
                desktop: 'Tell a compelling story.',
              },
            },
          },
        },
        {
          id: 'template-campaign-stack',
          component: 'gridstory.stack',
          version: 1,
          props: { gap: 'large', surface: 'subtle' },
          presentation: {
            designSystemVersion: 1,
            tokenBindings: { gap: 'spacing.section' },
          },
          slots: {
            content: [
              {
                id: 'template-campaign-copy',
                component: 'gridstory.rich-text',
                version: 1,
                props: {
                  heading: 'Campaign details',
                  body: 'Use application-owned components to shape this page.',
                },
              },
            ],
          },
        },
      ],
    },
  ],
} satisfies DesignSystemManifest;
