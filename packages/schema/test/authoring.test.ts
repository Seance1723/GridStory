import { describe, expect, it } from 'vitest';
import type { ContentSchemaDefinition } from '../src/index.js';
import { assetReferenceSchema, richTextDocumentSchema, validateContent } from '../src/index.js';

const schema: ContentSchemaDefinition = {
  id: 'article',
  version: 1,
  name: 'Article',
  description: '',
  collection: 'articles',
  titleField: 'title',
  fields: [
    { id: 'article.title', name: 'title', label: 'Title', type: 'text', required: true },
    {
      id: 'article.body',
      name: 'body',
      label: 'Body',
      type: 'rich-text',
      required: true,
      allowedBlocks: ['paragraph', 'heading'],
    },
    {
      id: 'article.image',
      name: 'image',
      label: 'Image',
      type: 'asset',
      accepts: ['image'],
      requiredAlt: true,
    },
  ],
};

describe('authoring contracts', () => {
  it('parses semantic rich-text content, marks, mentions, and asset metadata', () => {
    expect(
      richTextDocumentSchema.parse({
        version: 1,
        blocks: [
          {
            id: 'heading-1',
            type: 'heading',
            level: 2,
            content: [
              { type: 'text', text: 'Hello', marks: [{ type: 'bold' }] },
              { type: 'mention', actorId: 'reviewer', label: '@reviewer' },
            ],
          },
        ],
      }).blocks[0],
    ).toMatchObject({ type: 'heading', level: 2 });
    expect(
      assetReferenceSchema.parse({
        id: 'image-1',
        kind: 'image',
        url: 'https://assets.example.test/image.jpg',
        title: 'Campaign',
        alt: 'A campaign preview',
      }).kind,
    ).toBe('image');
  });

  it('enforces allowed blocks, asset kinds, and required image alternative text', () => {
    const result = validateContent(
      schema,
      {
        title: 'Article',
        body: {
          version: 1,
          blocks: [{ id: 'code-1', type: 'code', language: 'text', code: 'example' }],
        },
        image: {
          id: 'file-1',
          kind: 'file',
          url: 'https://assets.example.test/file.pdf',
          title: 'File',
        },
      },
      [],
    );

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['invalid_child', 'invalid_reference']),
    );

    const missingAlt = validateContent(
      schema,
      {
        title: 'Article',
        body: { version: 1, blocks: [] },
        image: {
          id: 'image-1',
          kind: 'image',
          url: 'https://assets.example.test/image.jpg',
          title: 'Image',
        },
      },
      [],
    );
    expect(missingAlt.issues).toContainEqual(
      expect.objectContaining({ code: 'required', path: ['image', 'alt'] }),
    );
  });
});
