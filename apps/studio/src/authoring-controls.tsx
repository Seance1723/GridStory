import { useMemo, useState, type ReactNode } from 'react';
import type { ContentEntry } from '@gridstory/client';
import type {
  AssetReference,
  ContentReference,
  FieldDefinition,
  RichTextBlock,
  RichTextDocument,
  RichTextInline,
  RichTextMark,
} from '@gridstory/schema';

type RichTextField = Extract<FieldDefinition, { type: 'rich-text' }>;
type AssetField = Extract<FieldDefinition, { type: 'asset' }>;
type RelationField = Extract<FieldDefinition, { type: 'relation' }>;

const demonstrationAssetLibrary: AssetReference[] = [
  {
    id: 'asset-campaign',
    kind: 'image',
    url: 'https://assets.gridstory.local/campaign.jpg',
    title: 'Campaign landscape',
    alt: 'A colorful campaign landscape',
    mimeType: 'image/jpeg',
    width: 1600,
    height: 900,
  },
  {
    id: 'asset-demo-video',
    kind: 'video',
    url: 'https://assets.gridstory.local/product-demo.mp4',
    title: 'Product demo',
    mimeType: 'video/mp4',
  },
  {
    id: 'asset-brief',
    kind: 'file',
    url: 'https://assets.gridstory.local/campaign-brief.pdf',
    title: 'Campaign brief',
    mimeType: 'application/pdf',
  },
];

function textInline(text: string): RichTextInline {
  return { type: 'text', text, marks: [] };
}

function emptyBlock(type: RichTextBlock['type']): RichTextBlock {
  const id = crypto.randomUUID();
  if (type === 'heading') return { id, type, level: 2, content: [textInline('Heading')] };
  if (type === 'list') return { id, type, ordered: false, items: [[textInline('List item')]] };
  if (type === 'quote') return { id, type, content: [textInline('Quote')] };
  if (type === 'code') return { id, type, language: 'text', code: '' };
  if (type === 'embed') return { id, type, reference: { id: 'choose-entry', contentType: 'page' } };
  if (type === 'table')
    return { id, type, rows: [[[textInline('Column 1')], [textInline('Column 2')]]] };
  return { id, type: 'paragraph', content: [textInline('New paragraph')] };
}

function inlineText(content: RichTextInline[]): string {
  return content.map((inline) => (inline.type === 'text' ? inline.text : inline.label)).join('');
}

function blockText(block: RichTextBlock): string {
  if (block.type === 'code') return block.code;
  if (block.type === 'list') return block.items.map(inlineText).join('\n');
  if (block.type === 'table')
    return block.rows.map((row) => row.map(inlineText).join('\t')).join('\n');
  if (block.type === 'embed') return `${block.reference.contentType}:${block.reference.id}`;
  return inlineText(block.content);
}

function withBlockText(block: RichTextBlock, text: string): RichTextBlock {
  if (block.type === 'code') return { ...block, code: text };
  if (block.type === 'list') {
    return {
      ...block,
      items: text.split('\n').map((item) => [textInline(item)]),
    };
  }
  if (block.type === 'table') {
    return {
      ...block,
      rows: text.split('\n').map((row) => row.split('\t').map((cell) => [textInline(cell)])),
    };
  }
  if (block.type === 'embed') return block;
  return { ...block, content: [textInline(text)] };
}

function markKey(mark: RichTextMark): string {
  return mark.type === 'link' ? `${mark.type}:${mark.href}` : mark.type;
}

function withMark(block: RichTextBlock, mark: RichTextMark): RichTextBlock {
  if (!('content' in block)) return block;
  const key = markKey(mark);
  const alreadyApplied = block.content.some(
    (inline) =>
      inline.type === 'text' && inline.marks.some((candidate) => markKey(candidate) === key),
  );
  return {
    ...block,
    content: block.content.map((inline) => {
      if (inline.type !== 'text') return inline;
      return {
        ...inline,
        marks: alreadyApplied
          ? inline.marks.filter((candidate) => markKey(candidate) !== key)
          : [...inline.marks, mark],
      };
    }),
  };
}

function entryLabel(entry: ContentEntry): string {
  return String(entry.data.title ?? entry.data.headline ?? entry.id);
}

function ReferenceChoices({
  entries,
  targets,
  onSelect,
}: {
  entries: ContentEntry[];
  targets: string[];
  onSelect: (reference: ContentReference) => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const choices = entries.filter(
    (entry) =>
      targets.includes(entry.contentType) &&
      `${entryLabel(entry)} ${entry.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="reference-choices">
      <input
        aria-label="Search references"
        placeholder="Search entries"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="picker-grid">
        {choices.map((entry) => (
          <button
            type="button"
            key={entry.id}
            onClick={() => onSelect({ id: entry.id, contentType: entry.contentType })}
          >
            <strong>{entryLabel(entry)}</strong>
            <small>{entry.contentType}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

export function RichTextControl({
  definition,
  value,
  entries,
  onChange,
}: {
  definition: RichTextField;
  value: unknown;
  entries: ContentEntry[];
  onChange: (value: RichTextDocument) => void;
}): ReactNode {
  const document: RichTextDocument =
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    (value as { version?: unknown }).version === 1 &&
    'blocks' in value &&
    Array.isArray((value as { blocks?: unknown }).blocks)
      ? (value as RichTextDocument)
      : { version: 1, blocks: [] };
  const [activeId, setActiveId] = useState(document.blocks[0]?.id ?? '');
  const [link, setLink] = useState('https://');
  const allowed = definition.allowedBlocks ?? [
    'paragraph',
    'heading',
    'list',
    'quote',
    'code',
    'embed',
    'table',
  ];
  const update = (id: string, updater: (block: RichTextBlock) => RichTextBlock) =>
    onChange({
      ...document,
      blocks: document.blocks.map((block) => (block.id === id ? updater(block) : block)),
    });
  const active = document.blocks.find((block) => block.id === activeId);

  return (
    <section className="authoring-field rich-text-editor" aria-label={definition.label}>
      <header>
        <span>{definition.label}</span>
        <small>Semantic blocks</small>
      </header>
      <div className="rich-text-toolbar" role="toolbar" aria-label={`${definition.label} toolbar`}>
        {(['bold', 'italic', 'underline', 'code'] as const).map((type) => (
          <button
            type="button"
            key={type}
            disabled={!active || !('content' in active)}
            onClick={() => active && update(active.id, (block) => withMark(block, { type }))}
          >
            {type}
          </button>
        ))}
        <input
          aria-label="Link URL"
          value={link}
          onChange={(event) => setLink(event.target.value)}
        />
        <button
          type="button"
          disabled={!active || !('content' in active) || !URL.canParse(link)}
          onClick={() =>
            active && update(active.id, (block) => withMark(block, { type: 'link', href: link }))
          }
        >
          link
        </button>
      </div>
      <div className="rich-text-blocks">
        {document.blocks.map((block, index) => (
          <article
            className={
              activeId === block.id ? 'rich-text-block rich-text-block--active' : 'rich-text-block'
            }
            key={block.id}
            onFocus={() => setActiveId(block.id)}
          >
            <header>
              <strong>
                {index + 1}. {block.type}
              </strong>
              <button
                type="button"
                aria-label={`Remove ${block.type} block ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...document,
                    blocks: document.blocks.filter((candidate) => candidate.id !== block.id),
                  })
                }
              >
                Remove
              </button>
            </header>
            {block.type === 'embed' ? (
              <ReferenceChoices
                entries={entries}
                targets={[block.reference.contentType]}
                onSelect={(reference) => update(block.id, () => ({ ...block, reference }))}
              />
            ) : (
              <textarea
                aria-label={`${definition.label} ${block.type} block ${index + 1}`}
                rows={block.type === 'table' || block.type === 'code' ? 5 : 3}
                value={blockText(block)}
                onChange={(event) =>
                  update(block.id, (candidate) => withBlockText(candidate, event.target.value))
                }
              />
            )}
          </article>
        ))}
      </div>
      <div className="block-adder">
        {allowed.map((type) => (
          <button
            type="button"
            key={type}
            onClick={() => {
              const block = emptyBlock(type);
              setActiveId(block.id);
              onChange({ ...document, blocks: [...document.blocks, block] });
            }}
          >
            + {type}
          </button>
        ))}
      </div>
    </section>
  );
}

export function AssetControl({
  definition,
  value,
  onChange,
  assets = demonstrationAssetLibrary,
}: {
  definition: AssetField;
  value: unknown;
  onChange: (value: AssetReference | undefined) => void;
  assets?: AssetReference[];
}): ReactNode {
  const selected =
    typeof value === 'object' && value !== null && 'kind' in value
      ? (value as AssetReference)
      : undefined;
  const availableAssets = assets.length > 0 ? assets : demonstrationAssetLibrary;
  const choices = availableAssets.filter((asset) =>
    (definition.accepts ?? ['image', 'video', 'file']).includes(asset.kind),
  );
  return (
    <section className="authoring-field asset-picker" aria-label={definition.label}>
      <header>
        <span>{definition.label}</span>
        <small>Asset library</small>
      </header>
      {selected ? (
        <div className="selected-reference">
          <strong>{selected.title}</strong>
          <span>{selected.kind}</span>
          {selected.kind === 'image' ? (
            <label>
              <span>Alternative text</span>
              <input
                value={selected.alt ?? ''}
                required={definition.requiredAlt}
                onChange={(event) => onChange({ ...selected, alt: event.target.value })}
              />
            </label>
          ) : null}
          <button type="button" onClick={() => onChange(undefined)}>
            Clear asset
          </button>
        </div>
      ) : null}
      <div className="picker-grid">
        {choices.map((asset) => (
          <button type="button" key={asset.id} onClick={() => onChange(asset)}>
            <strong>{asset.title}</strong>
            <small>{asset.kind}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

export function RelationControl({
  definition,
  value,
  entries,
  onChange,
}: {
  definition: RelationField;
  value: unknown;
  entries: ContentEntry[];
  onChange: (value: ContentReference | ContentReference[] | undefined) => void;
}): ReactNode {
  const selected = useMemo(
    () =>
      Array.isArray(value)
        ? (value as ContentReference[])
        : value
          ? [value as ContentReference]
          : [],
    [value],
  );
  const add = (reference: ContentReference) => {
    if (!definition.multiple) {
      onChange(reference);
      return;
    }
    if (selected.some((candidate) => candidate.id === reference.id)) return;
    if (definition.maximum !== undefined && selected.length >= definition.maximum) return;
    onChange([...selected, reference]);
  };
  return (
    <section className="authoring-field reference-picker" aria-label={definition.label}>
      <header>
        <span>{definition.label}</span>
        <small>
          {selected.length} selected
          {definition.maximum === undefined ? '' : ` / ${definition.maximum}`}
        </small>
      </header>
      <div className="selected-reference-list">
        {selected.map((reference) => {
          const entry = entries.find((candidate) => candidate.id === reference.id);
          return (
            <span key={reference.id}>
              {entry ? entryLabel(entry) : reference.id}
              <button
                type="button"
                aria-label={`Remove reference ${entry ? entryLabel(entry) : reference.id}`}
                onClick={() => {
                  const rest = selected.filter((candidate) => candidate.id !== reference.id);
                  onChange(definition.multiple ? rest : undefined);
                }}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      <ReferenceChoices entries={entries} targets={definition.targets} onSelect={add} />
    </section>
  );
}
