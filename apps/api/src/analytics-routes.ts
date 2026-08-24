import {
  type AnalyticsService,
  type AuthorizationPolicy,
  GridStoryActions,
  GridStoryError,
} from '@gridstory/core';
import { publicAnalyticsEventInputSchema } from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { authorize, contentScope, requestContext } from './request-context.js';

interface AnalyticsRouteOptions {
  service: AnalyticsService;
  policy: AuthorizationPolicy;
}

export async function registerAnalyticsRoutes(
  server: FastifyInstance,
  options: AnalyticsRouteOptions,
): Promise<void> {
  server.post('/api/v1/analytics/events', async (request, reply) => {
    const context = requestContext(request, 'published', true);
    authorize(options.policy, context, GridStoryActions.deliveryRead, { kind: 'platform' });
    const parsed = publicAnalyticsEventInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new GridStoryError('Analytics event is invalid.', 'invalid_analytics_event', 400, {
        issues: parsed.error.issues,
      });
    }
    const secGpc = request.headers['sec-gpc'];
    const result = await options.service.ingest(contentScope(context), {
      ...parsed.data,
      consent: {
        ...parsed.data.consent,
        globalPrivacyControl: parsed.data.consent.globalPrivacyControl || secGpc === '1',
      },
    });
    return reply.status(result.accepted ? 202 : 200).send(result);
  });

  server.get('/api/v1/analytics/report', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.operationsRead, { kind: 'platform' });
    return options.service.report(contentScope(context));
  });
}
