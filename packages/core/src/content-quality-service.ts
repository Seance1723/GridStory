import { createHash } from 'node:crypto';
import {
  buildContentRoute,
  collectContentReferences,
  contentQualityPolicySchema,
  richTextDocumentSchema,
  type ContentEntry,
  type ContentQualityPolicy,
  type ContentQualityReport,
  type ContentSchemaDefinition,
  type ContentScope,
  type QualityCategory,
  type QualityFinding,
  type QualitySeverity,
  type ResolvedContentQualityPolicy,
} from '@gridstory/schema';
import type { ContentRepository } from './types.js';

export interface ExternalLinkResult {
  ok: boolean;
  status?: number;
  message?: string;
}

export interface ExternalLinkChecker {
  check(url: string): Promise<ExternalLinkResult>;
}

export interface ContentQualityServiceOptions {
  repository: ContentRepository;
  schemas: ContentSchemaDefinition[];
  policies?: ContentQualityPolicy[];
  externalLinkChecker?: ExternalLinkChecker;
}

function fingerprint(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function words(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? [];
}

function syllables(word: string): number {
  const normalized = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!normalized) return 1;
  const groups = normalized.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups?.length ?? 1);
}

function readingGrade(text: string): number {
  const tokens = words(text);
  if (tokens.length === 0) return 0;
  const sentences = Math.max(1, text.split(/[.!?]+/).filter((value) => value.trim()).length);
  const totalSyllables = tokens.reduce((total, word) => total + syllables(word), 0);
  return 0.39 * (tokens.length / sentences) + 11.8 * (totalSyllables / tokens.length) - 15.59;
}

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (!['id', 'url', 'slug', 'actorId'].includes(key)) collectStrings(item, output);
    }
  }
}

function richTextFields(schema: ContentSchemaDefinition, data: Record<string, unknown>) {
  return schema.fields.flatMap((field) => {
    if (field.type !== 'rich-text') return [];
    const parsed = richTextDocumentSchema.safeParse(data[field.name]);
    return parsed.success ? [{ name: field.name, document: parsed.data }] : [];
  });
}

function summary(findings: QualityFinding[]): Record<QualitySeverity, number> {
  return {
    info: findings.filter((finding) => finding.severity === 'info').length,
    warning: findings.filter((finding) => finding.severity === 'warning').length,
    error: findings.filter((finding) => finding.severity === 'error').length,
  };
}

export class ContentQualityService {
  readonly #repository: ContentRepository;
  readonly #schemas: ReadonlyMap<string, ContentSchemaDefinition>;
  readonly #policies: ResolvedContentQualityPolicy[];
  readonly #externalLinkChecker: ExternalLinkChecker | undefined;

  constructor({
    repository,
    schemas,
    policies = [],
    externalLinkChecker,
  }: ContentQualityServiceOptions) {
    this.#repository = repository;
    this.#schemas = new Map(schemas.map((schema) => [schema.id, schema]));
    this.#policies = policies.map((policy) => contentQualityPolicySchema.parse(policy));
    this.#externalLinkChecker = externalLinkChecker;
  }

  #policy(entry: ContentEntry, channel: string): ResolvedContentQualityPolicy | undefined {
    return this.#policies.find(
      (policy) =>
        policy.contentType === entry.contentType &&
        policy.channels.includes(channel) &&
        (policy.locales.length === 0 || policy.locales.includes(entry.locale)),
    );
  }

  async assess(input: {
    scope: ContentScope;
    entry: ContentEntry;
    channel?: string;
    roles?: string[];
  }): Promise<ContentQualityReport> {
    const channel = input.channel ?? 'web';
    const policy = this.#policy(input.entry, channel);
    const base = {
      ...input.scope,
      entryId: input.entry.id,
      revisionId: input.entry.draftRevisionId,
      contentType: input.entry.contentType,
      channel,
    };
    if (!policy) {
      return {
        ...base,
        score: 100,
        passed: true,
        bypassed: false,
        summary: { info: 0, warning: 0, error: 0 },
        findings: [],
      };
    }

    const schema = this.#schemas.get(input.entry.contentType);
    if (!schema) throw new Error(`Content type ${input.entry.contentType} is not registered.`);
    const findings: QualityFinding[] = [];
    const add = (
      category: QualityCategory,
      code: string,
      severity: QualitySeverity,
      path: Array<string | number>,
      message: string,
      remediation: string,
      deduction: number,
    ) =>
      findings.push({
        id: fingerprint([policy.id, input.entry.id, code, path]),
        category,
        code,
        severity,
        path,
        message,
        remediation,
        deduction,
      });

    const titleField = policy.seo.titleField ?? schema.titleField;
    const title = stringValue(input.entry.data[titleField]);
    if (title.length < policy.seo.titleMinLength) {
      add(
        'seo',
        'seo_title_too_short',
        'warning',
        [titleField],
        `SEO title has ${title.length} characters; the policy minimum is ${policy.seo.titleMinLength}.`,
        'Write a descriptive search title within the configured range.',
        8,
      );
    } else if (title.length > policy.seo.titleMaxLength) {
      add(
        'seo',
        'seo_title_too_long',
        'warning',
        [titleField],
        `SEO title has ${title.length} characters; the policy maximum is ${policy.seo.titleMaxLength}.`,
        'Shorten the search title to avoid truncation.',
        5,
      );
    }
    if (policy.seo.descriptionField) {
      const description = stringValue(input.entry.data[policy.seo.descriptionField]);
      if (
        description.length < policy.seo.descriptionMinLength ||
        description.length > policy.seo.descriptionMaxLength
      ) {
        add(
          'seo',
          'seo_description_length',
          'warning',
          [policy.seo.descriptionField],
          `SEO description has ${description.length} characters; the configured range is ${policy.seo.descriptionMinLength}-${policy.seo.descriptionMaxLength}.`,
          'Revise the description to fit the configured search-snippet range.',
          5,
        );
      }
    }
    if (policy.seo.requireCanonicalRoute) {
      if (!schema.route) {
        add(
          'seo',
          'canonical_route_missing',
          'error',
          [],
          'This content type has no canonical route.',
          'Configure a route for this content type before publishing to the web channel.',
          15,
        );
      } else {
        try {
          buildContentRoute(schema, input.entry.data);
        } catch {
          add(
            'seo',
            'canonical_route_invalid',
            'error',
            [schema.route.slugField],
            'The canonical route cannot be generated.',
            'Provide a valid routed slug.',
            15,
          );
        }
      }
    }
    if (policy.seo.canonicalField) {
      const canonical = stringValue(input.entry.data[policy.seo.canonicalField]);
      try {
        if (!canonical || new URL(canonical).protocol !== 'https:') throw new Error('invalid');
      } catch {
        add(
          'seo',
          'canonical_url_invalid',
          'error',
          [policy.seo.canonicalField],
          'Canonical URL must be an absolute HTTPS URL.',
          'Enter the preferred public HTTPS URL.',
          15,
        );
      }
    }

    for (const field of schema.fields) {
      if (field.type !== 'asset') continue;
      const asset = input.entry.data[field.name];
      if (
        policy.accessibility.requireImageAlt &&
        typeof asset === 'object' &&
        asset !== null &&
        (asset as { kind?: unknown }).kind === 'image'
      ) {
        const alt = stringValue((asset as { alt?: unknown }).alt);
        if (!alt)
          add(
            'accessibility',
            'image_alt_missing',
            'error',
            [field.name, 'alt'],
            'Image alternative text is missing.',
            'Describe the image purpose, or explicitly mark decorative images in the asset provider.',
            15,
          );
        else if (/^(image|photo|picture|graphic)( of)?$/i.test(alt))
          add(
            'accessibility',
            'image_alt_poor',
            'warning',
            [field.name, 'alt'],
            'Image alternative text is not meaningful.',
            'Describe the information or purpose conveyed by the image.',
            8,
          );
      }
    }

    const externalLinks: Array<{ href: string; path: Array<string | number> }> = [];
    for (const rich of richTextFields(schema, input.entry.data)) {
      let priorHeading = 1;
      for (const [blockIndex, block] of rich.document.blocks.entries()) {
        const blockPath = [rich.name, 'blocks', blockIndex];
        if (block.type === 'heading') {
          if (policy.accessibility.enforceHeadingOrder && block.level > priorHeading + 1)
            add(
              'accessibility',
              'heading_order_skipped',
              'warning',
              [...blockPath, 'level'],
              `Heading level jumps from H${priorHeading} to H${block.level}.`,
              'Use headings in a logical, sequential outline.',
              5,
            );
          priorHeading = block.level;
        }
        if (block.type === 'table' && policy.accessibility.requireTableHeader)
          add(
            'accessibility',
            'table_header_missing',
            'warning',
            blockPath,
            'The rich-text table model does not identify header cells.',
            'Use a component with explicit row or column headers, or add header semantics before publishing.',
            8,
          );
        if (block.type === 'embed' && policy.links.requirePublishedReferences) {
          const target = await this.#repository.getById({
            scope: input.scope,
            id: block.reference.id,
            perspective: 'published',
          });
          if (!target || target.contentType !== block.reference.contentType)
            add(
              'links',
              'reference_not_published',
              'error',
              [...blockPath, 'reference'],
              `Referenced ${block.reference.contentType} content ${block.reference.id} is not published in this scope.`,
              'Publish the target entry or remove the embed.',
              20,
            );
        }
        const inlineGroups =
          block.type === 'list' ? block.items : 'content' in block ? [block.content] : [];
        for (const [groupIndex, inlineGroup] of inlineGroups.entries()) {
          for (const [inlineIndex, inline] of inlineGroup.entries()) {
            if (inline.type !== 'text') continue;
            for (const mark of inline.marks) {
              if (mark.type !== 'link') continue;
              const path = [
                ...blockPath,
                block.type === 'list' ? 'items' : 'content',
                groupIndex,
                inlineIndex,
              ];
              if (
                policy.accessibility.rejectGenericLinkText &&
                /^(click here|here|read more|learn more|link)$/i.test(inline.text.trim())
              )
                add(
                  'accessibility',
                  'link_purpose_unclear',
                  'warning',
                  path,
                  `Link text "${inline.text.trim()}" does not explain its purpose.`,
                  'Use link text that describes the destination.',
                  5,
                );
              externalLinks.push({ href: mark.href, path });
            }
          }
        }
      }
    }

    if (policy.links.requirePublishedReferences) {
      for (const located of collectContentReferences(schema, input.entry.data)) {
        const target = await this.#repository.getById({
          scope: input.scope,
          id: located.reference.id,
          perspective: 'published',
        });
        if (!target || target.contentType !== located.reference.contentType)
          add(
            'links',
            'reference_not_published',
            'error',
            located.path,
            `Referenced ${located.reference.contentType} content ${located.reference.id} is not published in this scope.`,
            'Publish the target entry or remove the reference.',
            20,
          );
      }
    }
    if (policy.links.checkExternal) {
      for (const link of externalLinks) {
        if (!this.#externalLinkChecker) {
          add(
            'links',
            'external_link_unchecked',
            'info',
            link.path,
            `External link ${link.href} was not checked because no link-check adapter is configured.`,
            'Configure an external-link adapter to verify remote destinations.',
            0,
          );
          continue;
        }
        const result = await this.#externalLinkChecker.check(link.href);
        if (!result.ok)
          add(
            'links',
            'external_link_broken',
            'error',
            link.path,
            result.message ??
              `External link ${link.href} did not resolve${result.status ? ` (HTTP ${result.status})` : ''}.`,
            'Correct or remove the destination URL.',
            15,
          );
      }
    }

    const textParts: string[] = [];
    collectStrings(input.entry.data, textParts);
    const body = textParts.join(' ');
    const wordCount = words(body).length;
    if (wordCount < policy.content.minWords)
      add(
        'content',
        'content_too_short',
        'warning',
        [],
        `Content has ${wordCount} words; the policy minimum is ${policy.content.minWords}.`,
        'Add useful, audience-appropriate detail.',
        5,
      );
    if (policy.content.maxReadingGrade !== undefined) {
      const grade = readingGrade(body);
      if (grade > policy.content.maxReadingGrade)
        add(
          'content',
          'reading_level_high',
          'warning',
          [],
          `Estimated reading grade is ${grade.toFixed(1)}; the policy maximum is ${policy.content.maxReadingGrade}.`,
          'Shorten sentences and prefer familiar words.',
          5,
        );
    }
    for (const phrase of policy.content.requiredPhrases) {
      if (
        !body
          .toLocaleLowerCase(input.entry.locale)
          .includes(phrase.toLocaleLowerCase(input.entry.locale))
      )
        add(
          'content',
          'required_phrase_missing',
          'warning',
          [],
          `Required phrase “${phrase}” is missing.`,
          'Add the required terminology in a natural, accurate context.',
          5,
        );
    }
    for (const phrase of policy.content.prohibitedPhrases) {
      if (
        body
          .toLocaleLowerCase(input.entry.locale)
          .includes(phrase.toLocaleLowerCase(input.entry.locale))
      )
        add(
          'content',
          'prohibited_phrase_used',
          'error',
          [],
          `Prohibited phrase “${phrase}” is present.`,
          'Replace the prohibited phrase with approved terminology.',
          10,
        );
    }

    const bypassed = policy.bypassRoles.some((role) => input.roles?.includes(role));
    const score = Math.max(
      0,
      100 - findings.reduce((total, finding) => total + finding.deduction, 0),
    );
    const blocked = findings.some((finding) =>
      policy.gate.blockedSeverities.includes(finding.severity),
    );
    return {
      ...base,
      policyId: policy.id,
      score,
      passed: bypassed || (!blocked && score >= policy.gate.minimumScore),
      bypassed,
      summary: summary(findings),
      findings,
    };
  }
}
