import type { FastifyInstance } from 'fastify';

export async function approveForPublication(
  server: FastifyInstance,
  entry: { id: string },
  headers: Record<string, string>,
): Promise<void> {
  const requesterHeaders = {
    ...headers,
    'x-gridstory-actor': `${headers['x-gridstory-actor'] ?? 'test'}-requester`,
    'x-gridstory-roles': 'admin',
  };
  const submitted = await server.inject({
    method: 'POST',
    url: `/api/v1/content/${entry.id}/workflow/transitions/submit-review`,
    headers: requesterHeaders,
    payload: { changedFields: ['title', 'slug', 'story', 'blocks'] },
  });
  if (submitted.statusCode !== 200) {
    throw new Error(`Workflow review submission failed: ${submitted.statusCode} ${submitted.body}`);
  }
  const requested = await server.inject({
    method: 'POST',
    url: `/api/v1/content/${entry.id}/workflow/transitions/approve`,
    headers: requesterHeaders,
    payload: { changedFields: ['title', 'slug', 'story', 'blocks'] },
  });
  if (requested.statusCode !== 200 || !requested.json().pendingApproval?.id) {
    throw new Error(`Workflow approval request failed: ${requested.statusCode} ${requested.body}`);
  }
  const approved = await server.inject({
    method: 'POST',
    url: `/api/v1/content/${entry.id}/workflow/approvals/${requested.json().pendingApproval.id}`,
    headers: {
      ...headers,
      'x-gridstory-actor': `${headers['x-gridstory-actor'] ?? 'test'}-reviewer`,
      'x-gridstory-roles': 'admin',
    },
    payload: { decision: 'approved', comment: 'Approved by the test reviewer.' },
  });
  if (approved.statusCode !== 200) {
    throw new Error(`Workflow approval failed: ${approved.statusCode} ${approved.body}`);
  }
}
