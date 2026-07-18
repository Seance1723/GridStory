import { SqliteContentRepository } from '../src/index.js';
import { repositoryConformance } from './repository-conformance.js';

repositoryConformance('SQLite', () => ({
  repository: new SqliteContentRepository({ filename: ':memory:' }),
}));
