import { z } from 'zod';
import type { ContentScope } from './context.js';

export const qualitySeveritySchema = z.enum(['info', 'warning', 'error']);
export const qualityCategorySchema = z.enum(['seo', 'accessibility', 'links', 'content']);

export const contentQualityPolicySchema = z.object({
  id: z.string().min(1),
  contentType: z.string().min(1),
  channels: z.array(z.string().min(1)).min(1).default(['web']),
  locales: z.array(z.string().min(1)).default([]),
  bypassRoles: z.array(z.string().min(1)).default([]),
  seo: z
    .object({
      titleField: z.string().min(1).optional(),
      descriptionField: z.string().min(1).optional(),
      canonicalField: z.string().min(1).optional(),
      titleMinLength: z.number().int().nonnegative().default(15),
      titleMaxLength: z.number().int().positive().default(60),
      descriptionMinLength: z.number().int().nonnegative().default(50),
      descriptionMaxLength: z.number().int().positive().default(160),
      requireCanonicalRoute: z.boolean().default(true),
    })
    .default({
      titleMinLength: 15,
      titleMaxLength: 60,
      descriptionMinLength: 50,
      descriptionMaxLength: 160,
      requireCanonicalRoute: true,
    }),
  accessibility: z
    .object({
      requireImageAlt: z.boolean().default(true),
      rejectGenericLinkText: z.boolean().default(true),
      enforceHeadingOrder: z.boolean().default(true),
      requireTableHeader: z.boolean().default(true),
    })
    .default({
      requireImageAlt: true,
      rejectGenericLinkText: true,
      enforceHeadingOrder: true,
      requireTableHeader: true,
    }),
  links: z
    .object({
      requirePublishedReferences: z.boolean().default(true),
      checkExternal: z.boolean().default(false),
    })
    .default({ requirePublishedReferences: true, checkExternal: false }),
  content: z
    .object({
      minWords: z.number().int().nonnegative().default(0),
      maxReadingGrade: z.number().min(1).max(20).optional(),
      requiredPhrases: z.array(z.string().min(1)).default([]),
      prohibitedPhrases: z.array(z.string().min(1)).default([]),
    })
    .default({ minWords: 0, requiredPhrases: [], prohibitedPhrases: [] }),
  gate: z
    .object({
      blockedSeverities: z.array(qualitySeveritySchema).default(['error']),
      minimumScore: z.number().int().min(0).max(100).default(0),
    })
    .default({ blockedSeverities: ['error'], minimumScore: 0 }),
});

export type ContentQualityPolicy = z.input<typeof contentQualityPolicySchema>;
export type ResolvedContentQualityPolicy = z.output<typeof contentQualityPolicySchema>;
export type QualitySeverity = z.infer<typeof qualitySeveritySchema>;
export type QualityCategory = z.infer<typeof qualityCategorySchema>;

export interface QualityFinding {
  id: string;
  category: QualityCategory;
  code: string;
  severity: QualitySeverity;
  path: Array<string | number>;
  message: string;
  remediation: string;
  deduction: number;
}

export interface ContentQualityReport extends ContentScope {
  entryId: string;
  revisionId: string;
  contentType: string;
  channel: string;
  policyId?: string;
  score: number;
  passed: boolean;
  bypassed: boolean;
  summary: Record<QualitySeverity, number>;
  findings: QualityFinding[];
}
