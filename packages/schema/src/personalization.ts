import { z } from 'zod';
import { resourceLimits } from './resource-limits.js';

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const labelSchema = z.string().min(1).max(160);
const attributeValueSchema = z.union([z.string().min(1).max(128), z.boolean()]);
const contentScopeSchema = z
  .object({
    organizationId: z.string().min(1),
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    siteId: z.string().min(1),
    environmentId: z.string().min(1),
    locale: z.string().min(1),
  })
  .strict();

function duplicates(values: string[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return repeated;
}

export const consentPurposeSchema = z
  .object({
    id: identifierSchema,
    name: labelSchema,
    description: z.string().min(1).max(500),
    honorGlobalPrivacyControl: z.boolean(),
  })
  .strict();

export type ConsentPurpose = z.output<typeof consentPurposeSchema>;

export const targetingAttributeSchema = z
  .object({
    key: identifierSchema,
    name: labelSchema,
    source: z.enum([
      'locale',
      'market',
      'device-class',
      'referral-category',
      'campaign',
      'authentication-state',
      'application',
    ]),
    valueType: z.enum(['boolean', 'enum']),
    allowedValues: z
      .array(identifierSchema)
      .max(resourceLimits.personalization.maximumAttributeValues),
    classification: z.enum(['public', 'personal']),
    requiredPurposes: z.array(identifierSchema).max(resourceLimits.personalization.maximumPurposes),
    cacheability: z.enum(['shared', 'private']),
  })
  .strict()
  .superRefine((attribute, context) => {
    if (attribute.valueType === 'enum' && attribute.allowedValues.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['allowedValues'],
        message: 'Enum attributes require at least one allowed value.',
      });
    }
    if (attribute.valueType === 'boolean' && attribute.allowedValues.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['allowedValues'],
        message: 'Boolean attributes cannot declare enum values.',
      });
    }
    if (duplicates(attribute.allowedValues).size > 0) {
      context.addIssue({
        code: 'custom',
        path: ['allowedValues'],
        message: 'Attribute values must be unique.',
      });
    }
    if (duplicates(attribute.requiredPurposes).size > 0) {
      context.addIssue({
        code: 'custom',
        path: ['requiredPurposes'],
        message: 'Required consent purposes must be unique.',
      });
    }
    if (attribute.classification === 'personal' && attribute.requiredPurposes.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['requiredPurposes'],
        message: 'Personal attributes require at least one consent purpose.',
      });
    }
    if (attribute.classification === 'personal' && attribute.cacheability !== 'private') {
      context.addIssue({
        code: 'custom',
        path: ['cacheability'],
        message: 'Personal attributes cannot participate in shared caches.',
      });
    }
    if (attribute.source === 'authentication-state' && attribute.cacheability !== 'private') {
      context.addIssue({
        code: 'custom',
        path: ['cacheability'],
        message: 'Authentication state cannot participate in shared caches.',
      });
    }
  });

export type TargetingAttribute = z.output<typeof targetingAttributeSchema>;

export const audienceConditionSchema = z
  .object({
    attributeKey: identifierSchema,
    operator: z.enum(['equals', 'not-equals']),
    value: attributeValueSchema,
  })
  .strict();

export type AudienceCondition = z.output<typeof audienceConditionSchema>;

export const audienceDefinitionSchema = z
  .object({
    id: identifierSchema,
    name: labelSchema,
    description: z.string().min(1).max(500),
    priority: z.number().int().nonnegative().max(1_000_000),
    conditions: z
      .array(audienceConditionSchema)
      .min(1)
      .max(resourceLimits.personalization.maximumConditionsPerAudience),
  })
  .strict();

export type AudienceDefinition = z.output<typeof audienceDefinitionSchema>;

export const personalizationDecisionSchema = z
  .object({
    resourceKey: identifierSchema,
    name: labelSchema,
    variants: z
      .array(identifierSchema)
      .min(1)
      .max(resourceLimits.personalization.maximumVariantsPerDecision),
    rules: z
      .array(
        z
          .object({
            audienceId: identifierSchema,
            variant: identifierSchema,
          })
          .strict(),
      )
      .max(resourceLimits.personalization.maximumRulesPerDecision),
    fallbackVariant: identifierSchema,
  })
  .strict();

export type PersonalizationDecision = z.output<typeof personalizationDecisionSchema>;

export const personalizationConfigurationSchema = z
  .object({
    purposes: z.array(consentPurposeSchema).max(resourceLimits.personalization.maximumPurposes),
    attributes: z
      .array(targetingAttributeSchema)
      .max(resourceLimits.personalization.maximumAttributes),
    audiences: z
      .array(audienceDefinitionSchema)
      .max(resourceLimits.personalization.maximumAudiences),
    decisions: z
      .array(personalizationDecisionSchema)
      .max(resourceLimits.personalization.maximumDecisions),
  })
  .strict()
  .superRefine((configuration, context) => {
    const purposeIds = new Set(configuration.purposes.map(({ id }) => id));
    const attributes = new Map(
      configuration.attributes.map((attribute) => [attribute.key, attribute]),
    );
    const audienceIds = new Set(configuration.audiences.map(({ id }) => id));

    for (const [field, values] of [
      ['purposes', configuration.purposes.map(({ id }) => id)],
      ['attributes', configuration.attributes.map(({ key }) => key)],
      ['audiences', configuration.audiences.map(({ id }) => id)],
      ['decisions', configuration.decisions.map(({ resourceKey }) => resourceKey)],
    ] as const) {
      if (duplicates(values).size > 0) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} identifiers must be unique.`,
        });
      }
    }
    if (duplicates(configuration.audiences.map(({ priority }) => String(priority))).size > 0) {
      context.addIssue({
        code: 'custom',
        path: ['audiences'],
        message: 'Audience priorities must be unique.',
      });
    }

    configuration.attributes.forEach((attribute, attributeIndex) => {
      attribute.requiredPurposes.forEach((purposeId, purposeIndex) => {
        if (!purposeIds.has(purposeId)) {
          context.addIssue({
            code: 'custom',
            path: ['attributes', attributeIndex, 'requiredPurposes', purposeIndex],
            message: `Unknown consent purpose ${purposeId}.`,
          });
        }
      });
    });

    configuration.audiences.forEach((audience, audienceIndex) => {
      audience.conditions.forEach((condition, conditionIndex) => {
        const attribute = attributes.get(condition.attributeKey);
        if (!attribute) {
          context.addIssue({
            code: 'custom',
            path: ['audiences', audienceIndex, 'conditions', conditionIndex, 'attributeKey'],
            message: `Unknown targeting attribute ${condition.attributeKey}.`,
          });
          return;
        }
        const validValue =
          attribute.valueType === 'boolean'
            ? typeof condition.value === 'boolean'
            : typeof condition.value === 'string' &&
              attribute.allowedValues.includes(condition.value);
        if (!validValue) {
          context.addIssue({
            code: 'custom',
            path: ['audiences', audienceIndex, 'conditions', conditionIndex, 'value'],
            message: `Condition value is invalid for ${condition.attributeKey}.`,
          });
        }
      });
    });

    configuration.decisions.forEach((decision, decisionIndex) => {
      const variants = new Set(decision.variants);
      if (variants.size !== decision.variants.length) {
        context.addIssue({
          code: 'custom',
          path: ['decisions', decisionIndex, 'variants'],
          message: 'Decision variants must be unique.',
        });
      }
      if (!variants.has(decision.fallbackVariant)) {
        context.addIssue({
          code: 'custom',
          path: ['decisions', decisionIndex, 'fallbackVariant'],
          message: 'Fallback variant must be declared by the decision.',
        });
      }
      if (duplicates(decision.rules.map(({ audienceId }) => audienceId)).size > 0) {
        context.addIssue({
          code: 'custom',
          path: ['decisions', decisionIndex, 'rules'],
          message: 'A decision can reference an audience only once.',
        });
      }
      decision.rules.forEach((rule, ruleIndex) => {
        if (!audienceIds.has(rule.audienceId)) {
          context.addIssue({
            code: 'custom',
            path: ['decisions', decisionIndex, 'rules', ruleIndex, 'audienceId'],
            message: `Unknown audience ${rule.audienceId}.`,
          });
        }
        if (!variants.has(rule.variant)) {
          context.addIssue({
            code: 'custom',
            path: ['decisions', decisionIndex, 'rules', ruleIndex, 'variant'],
            message: `Unknown variant ${rule.variant}.`,
          });
        }
      });
    });
  });

export type PersonalizationConfiguration = z.output<typeof personalizationConfigurationSchema>;

export const personalizationRevisionSchema = z
  .object({
    revision: z.number().int().positive(),
    configuration: personalizationConfigurationSchema,
    updatedAt: z.string().datetime(),
    updatedBy: z.string().min(1).max(128),
  })
  .strict();

export type PersonalizationRevision = z.output<typeof personalizationRevisionSchema>;

export const publishedPersonalizationRevisionSchema = personalizationRevisionSchema
  .extend({
    publishedAt: z.string().datetime(),
    publishedBy: z.string().min(1).max(128),
  })
  .strict();

export type PublishedPersonalizationRevision = z.output<
  typeof publishedPersonalizationRevisionSchema
>;

export const personalizationSnapshotSchema = contentScopeSchema
  .extend({
    schemaVersion: z.literal(1),
    version: z.number().int().nonnegative(),
    draft: personalizationRevisionSchema,
    published: publishedPersonalizationRevisionSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type PersonalizationSnapshot = z.output<typeof personalizationSnapshotSchema>;

export const personalizationConsentSchema = z
  .object({
    grantedPurposes: z.array(identifierSchema).max(resourceLimits.personalization.maximumPurposes),
    deniedPurposes: z.array(identifierSchema).max(resourceLimits.personalization.maximumPurposes),
    globalPrivacyControl: z.boolean(),
  })
  .strict()
  .superRefine((consent, context) => {
    if (duplicates(consent.grantedPurposes).size > 0) {
      context.addIssue({
        code: 'custom',
        path: ['grantedPurposes'],
        message: 'Granted consent purposes must be unique.',
      });
    }
    if (duplicates(consent.deniedPurposes).size > 0) {
      context.addIssue({
        code: 'custom',
        path: ['deniedPurposes'],
        message: 'Denied consent purposes must be unique.',
      });
    }
    const denied = new Set(consent.deniedPurposes);
    if (consent.grantedPurposes.some((purpose) => denied.has(purpose))) {
      context.addIssue({
        code: 'custom',
        path: ['grantedPurposes'],
        message: 'A consent purpose cannot be both granted and denied.',
      });
    }
  });

export type PersonalizationConsent = z.output<typeof personalizationConsentSchema>;

export const personalizationContextSchema = z
  .record(identifierSchema, attributeValueSchema)
  .superRefine((attributes, context) => {
    if (Object.keys(attributes).length > resourceLimits.personalization.maximumContextAttributes) {
      context.addIssue({
        code: 'custom',
        message: 'Too many targeting context attributes.',
      });
    }
  });

export type PersonalizationContext = z.output<typeof personalizationContextSchema>;

export const personalizationDecisionRequestSchema = z
  .object({
    resourceKey: identifierSchema,
    attributes: personalizationContextSchema,
    consent: personalizationConsentSchema,
  })
  .strict();

export type PersonalizationDecisionRequest = z.output<typeof personalizationDecisionRequestSchema>;

export const personalizationPreviewRequestSchema = personalizationDecisionRequestSchema
  .extend({
    override: z
      .object({
        audienceId: identifierSchema.optional(),
        variant: identifierSchema.optional(),
      })
      .strict()
      .refine((value) => value.audienceId !== undefined || value.variant !== undefined, {
        message: 'A preview override must name an audience or variant.',
      })
      .optional(),
  })
  .strict();

export type PersonalizationPreviewRequest = z.output<typeof personalizationPreviewRequestSchema>;

export const personalizationCacheGuidanceSchema = z
  .object({
    mode: z.enum(['shared', 'private', 'no-store']),
    key: z.string().min(1).max(2_048).optional(),
    tag: z.string().min(1).max(1_024),
    inputs: z.array(identifierSchema).max(resourceLimits.personalization.maximumAttributes),
    reason: z.string().min(1).max(240),
  })
  .strict();

export type PersonalizationCacheGuidance = z.output<typeof personalizationCacheGuidanceSchema>;

export const personalizationDecisionResultSchema = z
  .object({
    resourceKey: identifierSchema,
    variant: identifierSchema,
    reason: z.enum(['matched', 'fallback', 'override']),
    publishedRevision: z.number().int().positive(),
    cache: personalizationCacheGuidanceSchema,
  })
  .strict();

export type PersonalizationDecisionResult = z.output<typeof personalizationDecisionResultSchema>;

export const personalizationPreviewResultSchema = personalizationDecisionResultSchema
  .omit({ publishedRevision: true })
  .extend({
    audienceId: identifierSchema.optional(),
    draftRevision: z.number().int().positive(),
    trace: z
      .array(
        z
          .object({
            audienceId: identifierSchema,
            matched: z.boolean(),
            conditions: z
              .array(
                z
                  .object({
                    attributeKey: identifierSchema,
                    matched: z.boolean(),
                    reason: z.enum([
                      'matched',
                      'missing-attribute',
                      'consent-required',
                      'value-mismatch',
                    ]),
                  })
                  .strict(),
              )
              .max(resourceLimits.personalization.maximumConditionsPerAudience),
          })
          .strict(),
      )
      .max(resourceLimits.personalization.maximumRulesPerDecision),
  })
  .strict();

export type PersonalizationPreviewResult = z.output<typeof personalizationPreviewResultSchema>;
