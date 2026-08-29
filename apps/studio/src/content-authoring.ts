import {
  type ComponentManifest,
  type ComponentNode,
  type ContentSchemaDefinition,
  type FieldDefinition,
  type PropDefinition,
  type ValidationIssue,
  validateContent,
} from '@gridstory/schema';

export interface ContentCandidate {
  data: Record<string, unknown>;
  issues: ValidationIssue[];
  valid: boolean;
}

function boundedText(value: string, minimum = 1, maximum = Number.POSITIVE_INFINITY): string {
  const seed = value.trim() || 'Untitled';
  const padded = seed.length >= minimum ? seed : seed.padEnd(minimum, 'x');
  return padded.slice(0, maximum);
}

function propValue(prop: PropDefinition): unknown {
  if (prop.defaultValue !== undefined) return prop.defaultValue;
  if (!prop.required) return undefined;
  if (prop.type === 'text' || prop.type === 'textarea')
    return boundedText(prop.label, prop.minLength, prop.maxLength);
  if (prop.type === 'number') return prop.minimum ?? Math.min(0, prop.maximum ?? 0);
  if (prop.type === 'boolean') return false;
  return prop.values[0];
}

function componentNode(manifest: ComponentManifest, createId: () => string): ComponentNode {
  return {
    id: createId(),
    component: manifest.id,
    version: manifest.version,
    props: Object.fromEntries(
      manifest.props.flatMap((prop) => {
        const value = propValue(prop);
        return value === undefined ? [] : [[prop.name, value]];
      }),
    ),
    ...(manifest.slots.length > 0
      ? { slots: Object.fromEntries(manifest.slots.map((slot) => [slot.name, []])) }
      : {}),
  };
}

function fieldValue(
  field: FieldDefinition,
  schema: ContentSchemaDefinition,
  manifests: ComponentManifest[],
  suffix: string,
  createId: () => string,
): unknown {
  if (field.type === 'component-tree') {
    const accepted = new Set(field.accepts);
    const manifest = manifests.find(
      (candidate) =>
        candidate.status === 'active' && (accepted.size === 0 || accepted.has(candidate.id)),
    );
    if (!manifest) return [];
    return Array.from({ length: Math.max(1, field.minimum ?? 0) }, () =>
      componentNode(manifest, createId),
    );
  }
  if (!field.required) return undefined;
  if (field.type === 'slug') return `untitled-${suffix}`;
  if (field.type === 'text') {
    const label = field.name === schema.titleField ? `Untitled ${schema.name}` : field.label;
    return boundedText(label, field.minLength, field.maxLength);
  }
  if (field.type === 'rich-text') return { version: 1, blocks: [] };
  if (field.type === 'number') return field.minimum ?? Math.min(0, field.maximum ?? 0);
  if (field.type === 'boolean') return false;
  if (field.type === 'enum') return field.values[0];
  if (field.type === 'array') return [];
  if (field.type === 'relation') return field.multiple ? [] : undefined;
  if (field.type === 'taxonomy') {
    const firstTerm = schema.taxonomies
      ?.find((taxonomy) => taxonomy.id === field.taxonomy)
      ?.terms?.at(0)?.id;
    return field.multiple ? (firstTerm ? [firstTerm] : []) : firstTerm;
  }
  if (field.type === 'object') return {};
  if (field.type === 'union') {
    const variant = field.variants[0];
    return variant ? { [field.discriminator ?? 'type']: variant.id, value: {} } : {};
  }
  return undefined;
}

export function createContentCandidate({
  schema,
  manifests,
  suffix,
  createId = () => crypto.randomUUID(),
}: {
  schema: ContentSchemaDefinition;
  manifests: ComponentManifest[];
  suffix: string;
  createId?: () => string;
}): ContentCandidate {
  const data = Object.fromEntries(
    schema.fields.flatMap((field) => {
      const value = fieldValue(field, schema, manifests, suffix, createId);
      return value === undefined ? [] : [[field.name, value]];
    }),
  );
  const result = validateContent(schema, data, manifests);
  return { data, valid: result.valid, issues: result.issues };
}

export function candidateIssueMessage(issues: ValidationIssue[]): string {
  if (issues.length === 0) return 'The initial content candidate is invalid.';
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'content'}: ${issue.message}`)
    .join(' ');
}
