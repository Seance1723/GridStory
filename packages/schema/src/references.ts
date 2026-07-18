import type {
  ArrayItemDefinition,
  ContentReference,
  ContentSchemaDefinition,
  FieldDefinition,
} from './contracts.js';
import { contentReferenceSchema } from './contracts.js';

export interface LocatedContentReference {
  reference: ContentReference;
  path: Array<string | number>;
}

export function collectContentReferences(
  schema: ContentSchemaDefinition,
  data: Record<string, unknown>,
): LocatedContentReference[] {
  const references: LocatedContentReference[] = [];

  const collectReference = (value: unknown, path: Array<string | number>) => {
    const parsed = contentReferenceSchema.safeParse(value);
    if (parsed.success) references.push({ reference: parsed.data, path });
  };

  const collectObject = (objectType: string, value: unknown, path: Array<string | number>) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
    const object = schema.objects?.find((candidate) => candidate.id === objectType);
    if (!object) return;
    const record = value as Record<string, unknown>;
    for (const field of object.fields) {
      collectItem(field.value, record[field.name], [...path, field.name]);
    }
  };

  const collectItem = (item: ArrayItemDefinition, value: unknown, path: Array<string | number>) => {
    if (item.type === 'relation') collectReference(value, path);
    if (item.type === 'object') collectObject(item.objectType, value, path);
  };

  const collectField = (field: FieldDefinition, value: unknown) => {
    const path = [field.name];
    if (field.type === 'relation') {
      if (field.multiple && Array.isArray(value)) {
        value.forEach((reference, index) => {
          collectReference(reference, [...path, index]);
        });
      } else collectReference(value, path);
    } else if (field.type === 'object') {
      collectObject(field.objectType, value, path);
    } else if (field.type === 'array' && Array.isArray(value)) {
      value.forEach((item, index) => {
        collectItem(field.items, item, [...path, index]);
      });
    } else if (field.type === 'union' && typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      const variant = field.variants.find(
        (candidate) => candidate.id === record[field.discriminator ?? 'type'],
      );
      if (variant) collectObject(variant.objectType, record.value, [...path, 'value']);
    }
  };

  for (const field of schema.fields) collectField(field, data[field.name]);
  return references;
}
