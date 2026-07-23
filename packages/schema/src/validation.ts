import { assetReferenceSchema, richTextDocumentSchema } from './authoring.js';
import type {
  ArrayItemDefinition,
  ComponentManifest,
  ComponentNode,
  ContentSchemaDefinition,
  FieldDefinition,
  PropDefinition,
  ValidationIssue,
  ValidationResult,
} from './contracts.js';
import {
  componentManifestSchema,
  componentNodeSchema,
  contentReferenceSchema,
  contentSchemaDefinitionSchema,
} from './contracts.js';

export class SchemaValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super('Content failed schema validation.');
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateStringProp(
  prop: Extract<PropDefinition, { type: 'text' | 'textarea' }>,
  value: unknown,
  path: Array<string | number>,
  issues: ValidationIssue[],
): void {
  if (value === undefined || value === null || value === '') {
    if (prop.required) {
      issues.push({ code: 'required', path, message: `${prop.label} is required.` });
    }
    return;
  }
  if (typeof value !== 'string') {
    issues.push({ code: 'invalid_prop', path, message: `${prop.label} must be text.` });
    return;
  }
  if (prop.minLength !== undefined && value.length < prop.minLength) {
    issues.push({
      code: 'too_small',
      path,
      message: `${prop.label} must be at least ${prop.minLength} characters.`,
    });
  }
  if (prop.maxLength !== undefined && value.length > prop.maxLength) {
    issues.push({
      code: 'too_large',
      path,
      message: `${prop.label} must be at most ${prop.maxLength} characters.`,
    });
  }
}

function validateProp(
  prop: PropDefinition,
  value: unknown,
  path: Array<string | number>,
  issues: ValidationIssue[],
): void {
  if (prop.type === 'text' || prop.type === 'textarea') {
    validateStringProp(prop, value, path, issues);
    return;
  }

  if (value === undefined || value === null || value === '') {
    if (prop.required) {
      issues.push({ code: 'required', path, message: `${prop.label} is required.` });
    }
    return;
  }

  if (prop.type === 'enum') {
    if (typeof value !== 'string' || !prop.values.includes(value)) {
      issues.push({
        code: 'invalid_prop',
        path,
        message: `${prop.label} must be one of: ${prop.values.join(', ')}.`,
      });
    }
    return;
  }

  if (prop.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ code: 'invalid_prop', path, message: `${prop.label} must be a number.` });
      return;
    }
    if (prop.minimum !== undefined && value < prop.minimum) {
      issues.push({ code: 'too_small', path, message: `${prop.label} is below its minimum.` });
    }
    if (prop.maximum !== undefined && value > prop.maximum) {
      issues.push({ code: 'too_large', path, message: `${prop.label} exceeds its maximum.` });
    }
    return;
  }

  if (typeof value !== 'boolean') {
    issues.push({ code: 'invalid_prop', path, message: `${prop.label} must be true or false.` });
  }
}

function validateComponentNode(
  node: ComponentNode,
  path: Array<string | number>,
  manifests: Map<string, ComponentManifest>,
  issues: ValidationIssue[],
): void {
  const manifest = manifests.get(node.component);
  if (!manifest) {
    issues.push({
      code: 'unknown_component',
      path: [...path, 'component'],
      message: `Component ${node.component} is not registered.`,
    });
    return;
  }
  if (node.version !== manifest.version) {
    issues.push({
      code: 'component_version',
      path: [...path, 'version'],
      message: `${manifest.name} expects version ${manifest.version}, received ${node.version}.`,
    });
  }

  const declaredProps = new Map(manifest.props.map((prop) => [prop.name, prop]));
  for (const prop of manifest.props) {
    validateProp(prop, node.props[prop.name], [...path, 'props', prop.name], issues);
  }
  if (manifest.strictProps) {
    for (const name of Object.keys(node.props)) {
      if (!declaredProps.has(name)) {
        issues.push({
          code: 'unknown_prop',
          path: [...path, 'props', name],
          message: `${name} is not an allowed prop for ${manifest.name}.`,
        });
      }
    }
  }

  const declaredSlots = new Map(manifest.slots.map((slot) => [slot.name, slot]));
  for (const [slotName, children] of Object.entries(node.slots ?? {})) {
    const slot = declaredSlots.get(slotName);
    if (!slot) {
      issues.push({
        code: 'unknown_slot',
        path: [...path, 'slots', slotName],
        message: `${slotName} is not an allowed slot for ${manifest.name}.`,
      });
      continue;
    }
    if (children.length < slot.min) {
      issues.push({
        code: 'too_small',
        path: [...path, 'slots', slotName],
        message: `${slot.label} requires at least ${slot.min} child components.`,
      });
    }
    if (slot.max !== undefined && children.length > slot.max) {
      issues.push({
        code: 'too_large',
        path: [...path, 'slots', slotName],
        message: `${slot.label} accepts at most ${slot.max} child components.`,
      });
    }
    children.forEach((child, index) => {
      if (slot.accepts.length > 0 && !slot.accepts.includes(child.component)) {
        issues.push({
          code: 'invalid_child',
          path: [...path, 'slots', slotName, index],
          message: `${child.component} is not allowed in ${slot.label}.`,
        });
      }
      validateComponentNode(child, [...path, 'slots', slotName, index], manifests, issues);
    });
  }

  for (const slot of manifest.slots) {
    if (slot.min > 0 && !node.slots?.[slot.name]) {
      issues.push({
        code: 'required',
        path: [...path, 'slots', slot.name],
        message: `${slot.label} is required.`,
      });
    }
  }
}

function missing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function validateReference(
  value: unknown,
  targets: string[],
  path: Array<string | number>,
  issues: ValidationIssue[],
): void {
  const parsed = contentReferenceSchema.safeParse(value);
  if (!parsed.success || !targets.includes(parsed.data.contentType)) {
    issues.push({
      code: 'invalid_reference',
      path,
      message: `Reference must target one of: ${targets.join(', ')}.`,
    });
  }
}

function validateTaxonomyTerm(
  schema: ContentSchemaDefinition,
  taxonomyId: string,
  value: unknown,
  path: Array<string | number>,
  issues: ValidationIssue[],
): void {
  const taxonomy = schema.taxonomies?.find((candidate) => candidate.id === taxonomyId);
  if (!taxonomy) {
    issues.push({
      code: 'unknown_taxonomy',
      path,
      message: `Taxonomy ${taxonomyId} is not registered in this schema.`,
    });
    return;
  }
  if (typeof value !== 'string' || !(taxonomy.terms ?? []).some((term) => term.id === value)) {
    issues.push({
      code: 'invalid_term',
      path,
      message: `${String(value)} is not a term in ${taxonomy.name}.`,
    });
  }
}

function validateObject(
  schema: ContentSchemaDefinition,
  objectType: string,
  value: unknown,
  path: Array<string | number>,
  issues: ValidationIssue[],
): void {
  const definition = schema.objects?.find((candidate) => candidate.id === objectType);
  if (!definition) {
    issues.push({
      code: 'unknown_object',
      path,
      message: `Reusable object ${objectType} is not registered in this schema.`,
    });
    return;
  }
  if (!isRecord(value)) {
    issues.push({ code: 'invalid_type', path, message: `${definition.name} must be an object.` });
    return;
  }
  for (const field of definition.fields) {
    const fieldPath = [...path, field.name];
    const fieldValue = value[field.name];
    if (missing(fieldValue)) {
      if (field.required) {
        issues.push({ code: 'required', path: fieldPath, message: `${field.label} is required.` });
      }
      continue;
    }
    validateArrayItem(schema, field.value, fieldValue, fieldPath, issues);
  }
}

function validateArrayItem(
  schema: ContentSchemaDefinition,
  item: ArrayItemDefinition,
  value: unknown,
  path: Array<string | number>,
  issues: ValidationIssue[],
): void {
  if (item.type === 'text') {
    if (typeof value !== 'string') {
      issues.push({ code: 'invalid_type', path, message: 'Array item must be text.' });
    } else {
      if (item.minLength !== undefined && value.length < item.minLength) {
        issues.push({ code: 'too_small', path, message: 'Array text item is too short.' });
      }
      if (item.maxLength !== undefined && value.length > item.maxLength) {
        issues.push({ code: 'too_large', path, message: 'Array text item is too long.' });
      }
    }
    return;
  }
  if (item.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ code: 'invalid_type', path, message: 'Array item must be a number.' });
    } else {
      if (item.minimum !== undefined && value < item.minimum) {
        issues.push({ code: 'too_small', path, message: 'Array number is below its minimum.' });
      }
      if (item.maximum !== undefined && value > item.maximum) {
        issues.push({ code: 'too_large', path, message: 'Array number exceeds its maximum.' });
      }
    }
    return;
  }
  if (item.type === 'boolean') {
    if (typeof value !== 'boolean') {
      issues.push({ code: 'invalid_type', path, message: 'Array item must be true or false.' });
    }
    return;
  }
  if (item.type === 'enum') {
    if (typeof value !== 'string' || !item.values.includes(value)) {
      issues.push({ code: 'invalid_format', path, message: 'Array item is not an allowed value.' });
    }
    return;
  }
  if (item.type === 'object') {
    validateObject(schema, item.objectType, value, path, issues);
    return;
  }
  if (item.type === 'relation') {
    validateReference(value, item.targets, path, issues);
    return;
  }
  validateTaxonomyTerm(schema, item.taxonomy, value, path, issues);
}

function validateCardinality(
  values: unknown[],
  minimum: number,
  maximum: number | undefined,
  path: Array<string | number>,
  label: string,
  issues: ValidationIssue[],
): void {
  if (values.length < minimum) {
    issues.push({ code: 'too_small', path, message: `${label} has too few values.` });
  }
  if (maximum !== undefined && values.length > maximum) {
    issues.push({ code: 'too_large', path, message: `${label} has too many values.` });
  }
}

function validateField(
  schema: ContentSchemaDefinition,
  field: FieldDefinition,
  value: unknown,
  manifests: Map<string, ComponentManifest>,
  issues: ValidationIssue[],
): void {
  const path = [field.name];
  if (missing(value)) {
    if (field.required)
      issues.push({ code: 'required', path, message: `${field.label} is required.` });
    return;
  }

  if (field.type === 'text' || field.type === 'slug') {
    if (typeof value !== 'string') {
      issues.push({ code: 'invalid_type', path, message: `${field.label} must be text.` });
      return;
    }
    if (field.type === 'text') {
      if (field.minLength !== undefined && value.length < field.minLength) {
        issues.push({ code: 'too_small', path, message: `${field.label} is too short.` });
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        issues.push({ code: 'too_large', path, message: `${field.label} is too long.` });
      }
    } else if (!new RegExp(field.pattern ?? '^[a-z0-9]+(?:-[a-z0-9]+)*$').test(value)) {
      issues.push({ code: 'invalid_format', path, message: `${field.label} has an invalid slug.` });
    }
    return;
  }

  if (field.type === 'rich-text') {
    const parsed = richTextDocumentSchema.safeParse(value);
    if (!parsed.success) {
      issues.push({
        code: 'invalid_type',
        path,
        message: `${field.label} must be a valid rich-text document.`,
      });
      return;
    }
    const allowed = new Set(field.allowedBlocks);
    parsed.data.blocks.forEach((block, index) => {
      if (!allowed.has(block.type)) {
        issues.push({
          code: 'invalid_child',
          path: [...path, 'blocks', index],
          message: `${block.type} is not allowed in ${field.label}.`,
        });
      }
    });
    return;
  }

  if (field.type === 'asset') {
    const parsed = assetReferenceSchema.safeParse(value);
    if (!parsed.success) {
      issues.push({
        code: 'invalid_type',
        path,
        message: `${field.label} must be a valid asset reference.`,
      });
      return;
    }
    if (!(field.accepts ?? ['image', 'video', 'file']).includes(parsed.data.kind)) {
      issues.push({
        code: 'invalid_reference',
        path,
        message: `${parsed.data.kind} assets are not allowed in ${field.label}.`,
      });
    }
    if (field.requiredAlt && parsed.data.kind === 'image' && !parsed.data.alt?.trim()) {
      issues.push({
        code: 'required',
        path: [...path, 'alt'],
        message: `${field.label} requires alternative text.`,
      });
    }
    return;
  }
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ code: 'invalid_type', path, message: `${field.label} must be a number.` });
    } else {
      if (field.minimum !== undefined && value < field.minimum)
        issues.push({ code: 'too_small', path, message: `${field.label} is below its minimum.` });
      if (field.maximum !== undefined && value > field.maximum)
        issues.push({ code: 'too_large', path, message: `${field.label} exceeds its maximum.` });
    }
    return;
  }
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean')
      issues.push({ code: 'invalid_type', path, message: `${field.label} must be true or false.` });
    return;
  }
  if (field.type === 'enum') {
    if (typeof value !== 'string' || !field.values.includes(value))
      issues.push({
        code: 'invalid_format',
        path,
        message: `${field.label} is not an allowed value.`,
      });
    return;
  }
  if (field.type === 'object') {
    validateObject(schema, field.objectType, value, path, issues);
    return;
  }
  if (field.type === 'array') {
    if (!Array.isArray(value)) {
      issues.push({ code: 'invalid_type', path, message: `${field.label} must be a list.` });
      return;
    }
    validateCardinality(value, field.minimum ?? 0, field.maximum, path, field.label, issues);
    value.forEach((item, index) => {
      validateArrayItem(schema, field.items, item, [...path, index], issues);
    });
    return;
  }
  if (field.type === 'relation') {
    const values = field.multiple ? value : [value];
    if (!Array.isArray(values)) {
      issues.push({
        code: 'invalid_type',
        path,
        message: `${field.label} must be a reference list.`,
      });
      return;
    }
    validateCardinality(values, field.minimum ?? 0, field.maximum, path, field.label, issues);
    values.forEach((reference, index) => {
      validateReference(reference, field.targets, field.multiple ? [...path, index] : path, issues);
    });
    return;
  }
  if (field.type === 'taxonomy') {
    const values = field.multiple ? value : [value];
    if (!Array.isArray(values)) {
      issues.push({ code: 'invalid_type', path, message: `${field.label} must be a term list.` });
      return;
    }
    validateCardinality(values, field.minimum ?? 0, field.maximum, path, field.label, issues);
    values.forEach((term, index) => {
      validateTaxonomyTerm(
        schema,
        field.taxonomy,
        term,
        field.multiple ? [...path, index] : path,
        issues,
      );
    });
    return;
  }
  if (field.type === 'union') {
    if (!isRecord(value)) {
      issues.push({
        code: 'invalid_union',
        path,
        message: `${field.label} must be a union object.`,
      });
      return;
    }
    const discriminator = field.discriminator ?? 'type';
    const variantId = value[discriminator];
    const variant = field.variants.find((candidate) => candidate.id === variantId);
    if (!variant) {
      issues.push({
        code: 'invalid_union',
        path: [...path, discriminator],
        message: `${field.label} has an unknown variant.`,
      });
      return;
    }
    validateObject(schema, variant.objectType, value.value, [...path, 'value'], issues);
    return;
  }

  if (!Array.isArray(value)) {
    issues.push({
      code: 'invalid_type',
      path,
      message: `${field.label} must be a component list.`,
    });
    return;
  }
  validateCardinality(value, field.minimum ?? 0, field.maximum, path, field.label, issues);
  value.forEach((rawNode, index) => {
    const parsed = componentNodeSchema.safeParse(rawNode);
    if (!parsed.success) {
      issues.push({
        code: 'invalid_type',
        path: [...path, index],
        message: 'Component node has an invalid shape.',
      });
      return;
    }
    if ((field.accepts?.length ?? 0) > 0 && !field.accepts?.includes(parsed.data.component)) {
      issues.push({
        code: 'invalid_child',
        path: [...path, index],
        message: `${parsed.data.component} is not allowed in ${field.label}.`,
      });
    }
    validateComponentNode(parsed.data, [...path, index], manifests, issues);
  });
}

export function validateContent(
  schemaInput: ContentSchemaDefinition,
  value: unknown,
  manifestInputs: ComponentManifest[] = [],
): ValidationResult {
  const schema = contentSchemaDefinitionSchema.parse(schemaInput);
  const manifests = new Map(
    manifestInputs.map((manifestInput) => {
      const manifest = componentManifestSchema.parse(manifestInput);
      return [manifest.id, manifest] as const;
    }),
  );
  const issues: ValidationIssue[] = [];

  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{ code: 'invalid_type', path: [], message: 'Content must be an object.' }],
    };
  }

  for (const field of schema.fields)
    validateField(schema, field, value[field.name], manifests, issues);

  return { valid: issues.length === 0, issues };
}

export function assertValidContent(
  schema: ContentSchemaDefinition,
  value: unknown,
  manifests: ComponentManifest[] = [],
): asserts value is Record<string, unknown> {
  const result = validateContent(schema, value, manifests);
  if (!result.valid) {
    throw new SchemaValidationError(result.issues);
  }
}
