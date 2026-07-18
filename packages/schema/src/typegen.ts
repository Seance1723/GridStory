import type {
  ComponentManifest,
  ComponentNode,
  ContentReference,
  ContentSchemaDefinition,
  FieldDefinition,
  PropDefinition,
} from './contracts.js';

type Simplify<T> = { [Key in keyof T]: T[Key] } & {};
type DefinitionName<Definition> = Definition extends { name: infer Name extends string }
  ? Name
  : never;
type DefinitionByName<Definition, Name extends string> = Extract<Definition, { name: Name }>;

type ObjectById<Objects, Id extends string> = Objects extends readonly unknown[]
  ? Extract<Objects[number], { id: Id }>
  : never;
type ArrayItemValue<Item, Objects> = Item extends { type: 'number' }
  ? number
  : Item extends { type: 'boolean' }
    ? boolean
    : Item extends { type: 'enum'; values: readonly (infer Value extends string)[] }
      ? Value
      : Item extends { type: 'object'; objectType: infer Id extends string }
        ? ObjectValue<ObjectById<Objects, Id>, Objects>
        : Item extends { type: 'relation' }
          ? ContentReference
          : string;
type ObjectValue<Object, Objects> = Object extends { fields: readonly (infer Fields)[] }
  ? DataFromObjectDefinitions<Extract<Fields, { name: string; value: unknown }>, Objects>
  : Record<string, unknown>;
type UnionValue<Field, Objects> = Field extends {
  discriminator: infer Discriminator extends string;
  variants: readonly (infer Variant)[];
}
  ? Variant extends { id: infer Id extends string; objectType: infer ObjectId extends string }
    ? { [Key in Discriminator]: Id } & {
        value: ObjectValue<ObjectById<Objects, ObjectId>, Objects>;
      }
    : never
  : { type: string; value: Record<string, unknown> };
type FieldValue<Field, Objects = never> = Field extends { type: 'component-tree' }
  ? ComponentNode[]
  : Field extends { type: 'number' }
    ? number
    : Field extends { type: 'boolean' }
      ? boolean
      : Field extends { type: 'enum'; values: readonly (infer Value extends string)[] }
        ? Value
        : Field extends { type: 'object'; objectType: infer Id extends string }
          ? ObjectValue<ObjectById<Objects, Id>, Objects>
          : Field extends { type: 'array'; items: infer Item }
            ? ArrayItemValue<Item, Objects>[]
            : Field extends { type: 'relation'; multiple: true }
              ? ContentReference[]
              : Field extends { type: 'relation' }
                ? ContentReference
                : Field extends { type: 'taxonomy'; multiple: true }
                  ? string[]
                  : Field extends { type: 'union' }
                    ? UnionValue<Field, Objects>
                    : string;
type PropValue<Prop> = Prop extends { type: 'number' }
  ? number
  : Prop extends { type: 'boolean' }
    ? boolean
    : Prop extends { type: 'enum'; values: readonly (infer Value extends string)[] }
      ? Value
      : string;

type DataFromDefinitions<
  Definition extends { name: string; required?: boolean | undefined },
  ValueKind extends 'field' | 'prop',
  Objects = never,
> = Simplify<
  {
    [Name in DefinitionName<Definition> as DefinitionByName<
      Definition,
      Name
    >['required'] extends true
      ? Name
      : never]-?: ValueKind extends 'field'
      ? FieldValue<DefinitionByName<Definition, Name>, Objects>
      : PropValue<DefinitionByName<Definition, Name>>;
  } & {
    [Name in DefinitionName<Definition> as DefinitionByName<
      Definition,
      Name
    >['required'] extends true
      ? never
      : Name]?: ValueKind extends 'field'
      ? FieldValue<DefinitionByName<Definition, Name>, Objects>
      : PropValue<DefinitionByName<Definition, Name>>;
  }
>;

type DataFromObjectDefinitions<
  Definition extends { name: string; required?: boolean | undefined; value: unknown },
  Objects,
> = Simplify<
  {
    [Name in DefinitionName<Definition> as DefinitionByName<
      Definition,
      Name
    >['required'] extends true
      ? Name
      : never]-?: ArrayItemValue<DefinitionByName<Definition, Name>['value'], Objects>;
  } & {
    [Name in DefinitionName<Definition> as DefinitionByName<
      Definition,
      Name
    >['required'] extends true
      ? never
      : Name]?: ArrayItemValue<DefinitionByName<Definition, Name>['value'], Objects>;
  }
>;

/** Infers application-facing content data from a literal schema definition. */
export type ContentDataOf<
  Schema extends { fields: readonly FieldDefinition[]; objects?: readonly unknown[] },
> = DataFromDefinitions<Schema['fields'][number], 'field', Schema['objects']>;

/** Infers application component props from a literal serializable manifest. */
export type ComponentPropsOf<Manifest extends { props: readonly PropDefinition[] }> =
  DataFromDefinitions<Manifest['props'][number], 'prop'>;

export interface TypeScriptContractOptions {
  banner?: string;
  schemaImport?: string;
}

/** Validates a schema while preserving literal field names and required flags for type inference. */
export function defineContentSchema<const Schema extends ContentSchemaDefinition>(
  schema: Schema,
): Schema {
  return schema;
}

/** Validates a manifest while preserving literal prop names, values, and required flags. */
export function defineComponentManifest<const Manifest extends ComponentManifest>(
  manifest: Manifest,
): Manifest {
  return manifest;
}

function pascalCase(value: string): string {
  const name = value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');
  if (!name) return 'Generated';
  return /^\d/.test(name) ? `Generated${name}` : name;
}

function stringLiteral(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function propertyName(value: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(value) ? value : stringLiteral(value);
}

function arrayItemType(
  item: Extract<FieldDefinition, { type: 'array' }>['items'],
  objectNames: Map<string, string>,
): string {
  if (item.type === 'number') return 'number';
  if (item.type === 'boolean') return 'boolean';
  if (item.type === 'enum') return item.values.map(stringLiteral).join(' | ');
  if (item.type === 'object') return objectNames.get(item.objectType) ?? 'Record<string, unknown>';
  if (item.type === 'relation') return 'ContentReference';
  return 'string';
}

function fieldType(field: FieldDefinition, objectNames: Map<string, string>): string {
  if (field.type === 'component-tree') return 'ComponentNode[]';
  if (field.type === 'number') return 'number';
  if (field.type === 'boolean') return 'boolean';
  if (field.type === 'enum') return field.values.map(stringLiteral).join(' | ');
  if (field.type === 'object')
    return objectNames.get(field.objectType) ?? 'Record<string, unknown>';
  if (field.type === 'array') return `Array<${arrayItemType(field.items, objectNames)}>`;
  if (field.type === 'relation') return field.multiple ? 'ContentReference[]' : 'ContentReference';
  if (field.type === 'taxonomy') return field.multiple ? 'string[]' : 'string';
  if (field.type === 'union') {
    return field.variants
      .map((variant) => {
        const objectType = objectNames.get(variant.objectType) ?? 'Record<string, unknown>';
        return `{ ${propertyName(field.discriminator ?? 'type')}: ${stringLiteral(variant.id)}; value: ${objectType} }`;
      })
      .join(' | ');
  }
  return 'string';
}

function propType(prop: PropDefinition): string {
  if (prop.type === 'number') return 'number';
  if (prop.type === 'boolean') return 'boolean';
  if (prop.type === 'enum') return prop.values.map(stringLiteral).join(' | ');
  return 'string';
}

function property(name: string, required: boolean, type: string): string {
  return `  ${propertyName(name)}${required ? '' : '?'}: ${type};`;
}

function usesContentReference(schema: ContentSchemaDefinition): boolean {
  return (
    schema.fields.some(
      (field) =>
        field.type === 'relation' || (field.type === 'array' && field.items.type === 'relation'),
    ) ||
    (schema.objects ?? []).some((object) =>
      object.fields.some((field) => field.value.type === 'relation'),
    )
  );
}

function uniqueTypeNames(ids: string[], suffix: string): Map<string, string> {
  const allocated = new Set<string>();
  return new Map(
    ids.map((id) => {
      const base = `${pascalCase(id)}${suffix}`;
      let candidate = base;
      let sequence = 2;
      while (allocated.has(candidate)) {
        candidate = `${base}${sequence}`;
        sequence += 1;
      }
      allocated.add(candidate);
      return [id, candidate];
    }),
  );
}

/** Produces deterministic `.d.ts`-ready source for schema-as-code consumers. */
export function generateTypeScriptContracts(
  schemas: ContentSchemaDefinition[],
  manifests: ComponentManifest[],
  options: TypeScriptContractOptions = {},
): string {
  const schemaNames = uniqueTypeNames(
    schemas.map((schema) => schema.id),
    'Content',
  );
  const propNames = uniqueTypeNames(
    manifests.map((manifest) => manifest.id),
    'Props',
  );
  const slotNames = uniqueTypeNames(
    manifests.map((manifest) => manifest.id),
    'Slots',
  );
  const imports = [
    ...(schemas.some((schema) => schema.fields.some((field) => field.type === 'component-tree')) ||
    manifests.some((manifest) => manifest.slots.length > 0)
      ? ['ComponentNode']
      : []),
    ...(schemas.some(usesContentReference) ? ['ContentReference'] : []),
  ];
  const lines = [options.banner ?? '/* Generated by GridStory. Do not edit directly. */'];
  if (imports.length > 0) {
    lines.push(
      `import type { ${imports.join(', ')} } from ${stringLiteral(options.schemaImport ?? '@gridstory/schema')};`,
    );
  }
  lines.push('');

  for (const schema of schemas) {
    const objects = schema.objects ?? [];
    const objectNames = uniqueTypeNames(
      objects.map((object) => `${schema.id}-${object.id}`),
      'Object',
    );
    const namesByObjectId = new Map(
      objects.map((object) => [
        object.id,
        objectNames.get(`${schema.id}-${object.id}`) ?? 'Record<string, unknown>',
      ]),
    );
    for (const object of objects) {
      const name = namesByObjectId.get(object.id);
      if (object.fields.length === 0) {
        lines.push(`export type ${name} = Record<string, never>;`, '');
      } else {
        lines.push(`export interface ${name} {`);
        lines.push(
          ...object.fields.map((field) =>
            property(
              field.name,
              Boolean(field.required),
              arrayItemType(field.value, namesByObjectId),
            ),
          ),
        );
        lines.push('}', '');
      }
    }
    lines.push(`export interface ${schemaNames.get(schema.id)} {`);
    lines.push(
      ...schema.fields.map((field) =>
        property(field.name, Boolean(field.required), fieldType(field, namesByObjectId)),
      ),
    );
    lines.push('}', '');
  }

  for (const manifest of manifests) {
    const propName = propNames.get(manifest.id);
    if (manifest.props.length === 0) {
      lines.push(`export type ${propName} = Record<string, never>;`, '');
    } else {
      lines.push(`export interface ${propName} {`);
      lines.push(
        ...manifest.props.map((prop) => property(prop.name, prop.required, propType(prop))),
      );
      lines.push('}', '');
    }
    const slotName = slotNames.get(manifest.id);
    if (manifest.slots.length === 0) {
      lines.push(`export type ${slotName} = Record<string, never>;`, '');
    } else {
      lines.push(`export interface ${slotName} {`);
      lines.push(
        ...manifest.slots.map((slot) => property(slot.name, slot.min > 0, 'ComponentNode[]')),
      );
      lines.push('}', '');
    }
  }

  lines.push('export interface ContentByType {');
  lines.push(
    ...schemas.map((schema) => property(schema.id, true, schemaNames.get(schema.id) ?? 'never')),
  );
  lines.push('}', '', 'export interface ComponentPropsById {');
  lines.push(
    ...manifests.map((manifest) =>
      property(manifest.id, true, propNames.get(manifest.id) ?? 'never'),
    ),
  );
  lines.push('}', '');

  return `${lines.join('\n').trimEnd()}\n`;
}
