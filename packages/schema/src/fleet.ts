import { z } from 'zod';
import { interoperabilityDiscoverySchema } from './interoperability.js';
import { resourceLimits } from './resource-limits.js';

const identifier = z.string().min(1).max(200);
const scopeFields = {
  organizationId: identifier,
  tenantId: identifier,
  workspaceId: identifier,
  siteId: identifier,
  environmentId: identifier,
  locale: identifier,
};

export const fleetMemberSchema = z
  .object({
    id: identifier,
    generation: z.number().int().positive(),
    label: z.string().min(1).max(resourceLimits.fleet.maximumLabelCharacters),
    adapterId: z.string().min(1).max(resourceLimits.fleet.maximumAdapterIdCharacters),
    expectedInstanceId: identifier,
    expectedServiceVersion: z
      .string()
      .min(1)
      .max(resourceLimits.fleet.maximumServiceVersionCharacters)
      .optional(),
    state: z.enum(['active', 'paused']),
    createdAt: z.string().datetime({ offset: true }),
    createdBy: identifier,
    updatedAt: z.string().datetime({ offset: true }),
    updatedBy: identifier,
  })
  .strict();

export const fleetConditionSchema = z
  .object({
    type: z.enum(['Reachable', 'Ready', 'Compatible']),
    status: z.enum(['true', 'false', 'unknown']),
    reason: z
      .string()
      .regex(/^[A-Z][A-Za-z0-9]+$/u)
      .max(80),
    message: z.string().min(1).max(240),
    observedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const fleetObservationSchema = z
  .object({
    id: identifier,
    memberId: identifier,
    memberGeneration: z.number().int().positive(),
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    instance: z
      .object({
        instanceId: identifier,
        serviceVersion: z.string().min(1).max(resourceLimits.fleet.maximumServiceVersionCharacters),
        protocolVersion: z.literal(1),
        specifications: interoperabilityDiscoverySchema.shape.specifications,
      })
      .strict()
      .optional(),
    conditions: z.array(fleetConditionSchema).length(3),
  })
  .strict()
  .superRefine((observation, context) => {
    const types = observation.conditions.map((condition) => condition.type);
    if (
      new Set(types).size !== 3 ||
      (['Reachable', 'Ready', 'Compatible'] as const).some((type) => !types.includes(type))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['conditions'],
        message:
          'Fleet observations require exactly one Reachable, Ready, and Compatible condition.',
      });
    }
  });

export const fleetEventSchema = z
  .object({
    id: identifier,
    type: z.enum([
      'member.added',
      'member.updated',
      'member.paused',
      'member.removed',
      'member.checked',
    ]),
    memberId: identifier,
    memberGeneration: z.number().int().positive(),
    actorId: identifier,
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const fleetDocumentSchema = z
  .object({
    ...scopeFields,
    schemaVersion: z.literal(1),
    version: z.number().int().nonnegative(),
    members: z.array(fleetMemberSchema).max(resourceLimits.fleet.maximumMembers),
    observations: z.array(fleetObservationSchema).max(resourceLimits.fleet.maximumObservations),
    events: z.array(fleetEventSchema).max(resourceLimits.fleet.maximumEvents),
    updatedAt: z.string().datetime({ offset: true }),
    updatedBy: identifier,
  })
  .strict();

export const fleetMemberInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    label: z.string().min(1).max(resourceLimits.fleet.maximumLabelCharacters),
    adapterId: z.string().min(1).max(resourceLimits.fleet.maximumAdapterIdCharacters),
    expectedInstanceId: identifier,
    expectedServiceVersion: z
      .string()
      .min(1)
      .max(resourceLimits.fleet.maximumServiceVersionCharacters)
      .optional(),
  })
  .strict();

export const fleetExpectedVersionInputSchema = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();

export const fleetMemberStateInputSchema = fleetExpectedVersionInputSchema.extend({
  state: z.enum(['active', 'paused']),
});

export const fleetAdapterObservationSchema = z
  .object({
    discovery: interoperabilityDiscoverySchema,
    health: z.object({ status: z.literal('ok'), service: z.literal('gridstory-api') }).strict(),
    readiness: z.object({ status: z.literal('ready') }).strict(),
    observedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type FleetMember = z.infer<typeof fleetMemberSchema>;
export type FleetCondition = z.infer<typeof fleetConditionSchema>;
export type FleetObservation = z.infer<typeof fleetObservationSchema>;
export type FleetEvent = z.infer<typeof fleetEventSchema>;
export type FleetDocument = z.infer<typeof fleetDocumentSchema>;
export type FleetMemberInput = z.infer<typeof fleetMemberInputSchema>;
export type FleetExpectedVersionInput = z.infer<typeof fleetExpectedVersionInputSchema>;
export type FleetMemberStateInput = z.infer<typeof fleetMemberStateInputSchema>;
export type FleetAdapterObservation = z.infer<typeof fleetAdapterObservationSchema>;
