import { Pool } from 'pg';
import { describe, it } from 'vitest';
import { PostgresContentRepository } from '../src/index.js';
import { repositoryConformance } from './repository-conformance.js';

const connectionString = process.env.GRIDSTORY_TEST_POSTGRES_URL;
let schemaSequence = 0;

if (connectionString) {
  repositoryConformance('PostgreSQL', () => {
    const schema = `gridstory_test_${process.pid}_${schemaSequence++}`;
    const pool = new Pool({ connectionString });
    return {
      repository: new PostgresContentRepository({ pool, schema }),
      cleanup: async () => {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
      },
    };
  });
} else {
  describe.skip('PostgreSQL repository conformance', () => {
    it('requires GRIDSTORY_TEST_POSTGRES_URL', () => undefined);
  });
}
