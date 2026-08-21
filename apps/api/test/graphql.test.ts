import { resourceLimits } from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const headers = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'graphql-limit-tenant',
  'x-gridstory-actor': 'graphql-limit-test',
};

describe('GraphQL resource limits', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('rejects excessive aliases and field selections while batching remains disabled', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const aliases = Array.from(
      { length: resourceLimits.graphql.maximumAliases + 1 },
      (_, index) => `field${index}: schemas`,
    ).join('\n');
    const aliasResponse = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers,
      payload: { query: `query TooManyAliases { ${aliases} }` },
    });
    expect(aliasResponse.statusCode).toBe(400);
    expect(aliasResponse.json().errors[0].message).toContain('aliases');

    const selections = Array.from(
      { length: resourceLimits.graphql.maximumFieldSelections + 1 },
      () => 'id',
    ).join('\n');
    const selectionResponse = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers,
      payload: {
        query: `query TooManySelections { contents { nodes { ${selections} } } }`,
      },
    });
    expect(selectionResponse.statusCode).toBe(400);
    expect(selectionResponse.json().errors[0].message).toContain('field selections');

    const batchResponse = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers,
      payload: [{ query: 'query One { schemas }' }, { query: 'query Two { components }' }],
    });
    expect(batchResponse.statusCode).toBe(400);
  });
});
