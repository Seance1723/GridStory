import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  constants as fileConstants,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type BackupDatabase = 'sqlite' | 'postgresql';
export type BackupFormat = 'sqlite-vacuum' | 'postgresql-custom';

export interface BackupManifest {
  schemaVersion: 1;
  database: BackupDatabase;
  format: BackupFormat;
  createdAt: string;
  backupFile: string;
  byteLength: number;
  sha256: string;
}

export interface RecoveryCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type RecoveryCommandRunner = (
  command: string,
  args: string[],
  environment?: NodeJS.ProcessEnv,
) => RecoveryCommandResult;

interface PostgresRecoveryOptions {
  commandRunner?: RecoveryCommandRunner;
}

const manifestSuffix = '.manifest.json';
const requiredSqliteTables = [
  'audit_events',
  'durable_jobs',
  'entries',
  'gridstory_content_federation_documents',
  'gridstory_knowledge_documents',
  'gridstory_regional_documents',
  'revisions',
  'schema_deployments',
] as const;
const postgresGridStoryProbe = `SELECT CASE
  WHEN to_regclass('gridstory.entries') IS NOT NULL
   AND to_regclass('gridstory.revisions') IS NOT NULL
   AND to_regclass('gridstory.schema_deployments') IS NOT NULL
   AND to_regclass('gridstory.gridstory_content_federation_documents') IS NOT NULL
   AND to_regclass('gridstory.gridstory_knowledge_documents') IS NOT NULL
   AND to_regclass('gridstory.gridstory_regional_documents') IS NOT NULL
  THEN 'ok' ELSE 'missing' END;`;
const postgresUserRelationCount = `SELECT count(*)
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND namespace.nspname NOT LIKE 'pg_toast%'
    AND namespace.nspname NOT LIKE 'pg_temp_%';`;

function defaultCommandRunner(
  command: string,
  args: string[],
  environment = process.env,
): RecoveryCommandResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  };
}

function toolFailure(command: string, result: RecoveryCommandResult): Error {
  const detail = (result.error?.message ?? result.stderr.trim()).slice(0, 500);
  return new Error(
    `${command} failed${result.status === null ? '' : ` with exit code ${result.status}`}${
      detail ? `: ${detail}` : ''
    }`,
  );
}

function runTool(
  runner: RecoveryCommandRunner,
  command: string,
  args: string[],
  environment?: NodeJS.ProcessEnv,
): RecoveryCommandResult {
  const result = runner(command, args, environment);
  if (result.error || result.status !== 0) throw toolFailure(command, result);
  return result;
}

async function sha256File(filename: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function manifestPath(backupPath: string): string {
  return `${resolve(backupPath)}${manifestSuffix}`;
}

function requireAbsent(filename: string, label: string): void {
  if (existsSync(filename)) throw new Error(`${label} already exists: ${filename}`);
}

function assertDistinctPaths(sourcePath: string, targetPath: string): void {
  if (resolve(sourcePath) === resolve(targetPath)) {
    throw new Error('Source and target database paths must be different.');
  }
}

function validateManifest(value: unknown, backupPath: string): BackupManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Backup manifest must be a JSON object.');
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expectedKeys = [
    'backupFile',
    'byteLength',
    'createdAt',
    'database',
    'format',
    'schemaVersion',
    'sha256',
  ].sort();
  if (keys.join('\n') !== expectedKeys.join('\n')) {
    throw new Error('Backup manifest fields do not match schema version 1.');
  }
  if (candidate.schemaVersion !== 1) throw new Error('Backup manifest version is unsupported.');
  if (candidate.database !== 'sqlite' && candidate.database !== 'postgresql') {
    throw new Error('Backup manifest database is unsupported.');
  }
  const expectedFormat = candidate.database === 'sqlite' ? 'sqlite-vacuum' : 'postgresql-custom';
  if (candidate.format !== expectedFormat) {
    throw new Error('Backup manifest database and format do not match.');
  }
  if (candidate.backupFile !== basename(resolve(backupPath))) {
    throw new Error('Backup manifest filename does not match the archive.');
  }
  if (
    typeof candidate.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.createdAt)) ||
    new Date(candidate.createdAt).toISOString() !== candidate.createdAt
  ) {
    throw new Error('Backup manifest creation time is invalid.');
  }
  if (
    typeof candidate.byteLength !== 'number' ||
    !Number.isSafeInteger(candidate.byteLength) ||
    candidate.byteLength <= 0
  ) {
    throw new Error('Backup manifest byte length is invalid.');
  }
  if (typeof candidate.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.sha256)) {
    throw new Error('Backup manifest checksum is invalid.');
  }
  return candidate as unknown as BackupManifest;
}

function readManifest(backupPath: string): BackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath(backupPath), 'utf8'));
  } catch (error) {
    throw new Error('Backup manifest is missing or invalid JSON.', { cause: error });
  }
  return validateManifest(parsed, backupPath);
}

async function createManifest(
  backupPath: string,
  database: BackupDatabase,
  format: BackupFormat,
  now: () => Date,
): Promise<BackupManifest> {
  const resolvedBackup = resolve(backupPath);
  chmodSync(resolvedBackup, 0o600);
  const manifest: BackupManifest = {
    schemaVersion: 1,
    database,
    format,
    createdAt: now().toISOString(),
    backupFile: basename(resolvedBackup),
    byteLength: statSync(resolvedBackup).size,
    sha256: await sha256File(resolvedBackup),
  };
  writeFileSync(manifestPath(resolvedBackup), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return manifest;
}

function verifySqliteDatabase(filename: string): void {
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    const integrity = database.prepare('PRAGMA integrity_check').all() as Array<
      Record<string, unknown>
    >;
    if (
      integrity.length !== 1 ||
      String(Object.values(integrity[0] ?? {})[0] ?? '').toLowerCase() !== 'ok'
    ) {
      throw new Error('SQLite integrity check failed.');
    }
    const tables = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN (${requiredSqliteTables.map(() => '?').join(', ')})`,
      )
      .all(...requiredSqliteTables) as Array<{ name: string }>;
    const present = new Set(tables.map((row) => row.name));
    const missing = requiredSqliteTables.filter((table) => !present.has(table));
    if (missing.length > 0) {
      throw new Error(`SQLite backup is missing GridStory tables: ${missing.join(', ')}.`);
    }
  } finally {
    database.close();
  }
}

function postgresConnection(databaseUrl: string): {
  databaseName: string;
  environment: NodeJS.ProcessEnv;
} {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('PostgreSQL recovery requires an absolute database URL.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('PostgreSQL recovery requires a postgres:// or postgresql:// URL.');
  }
  if (parsed.hash) throw new Error('PostgreSQL recovery URL must not contain a fragment.');
  const unsupportedParameters = [...parsed.searchParams.keys()].filter((key) => key !== 'sslmode');
  if (unsupportedParameters.length > 0) {
    throw new Error(
      `PostgreSQL recovery URL has unsupported parameters: ${unsupportedParameters.join(', ')}.`,
    );
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!databaseName || databaseName.includes('/')) {
    throw new Error('PostgreSQL recovery URL must name exactly one database.');
  }
  const sslMode = parsed.searchParams.get('sslmode');
  if (
    sslMode &&
    !['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslMode)
  ) {
    throw new Error('PostgreSQL recovery URL has an unsupported sslmode.');
  }
  return {
    databaseName,
    environment: {
      ...process.env,
      PGHOST: parsed.hostname,
      PGPORT: parsed.port || '5432',
      PGUSER: decodeURIComponent(parsed.username),
      PGPASSWORD: decodeURIComponent(parsed.password),
      PGDATABASE: databaseName,
      PGCONNECT_TIMEOUT: '10',
      ...(sslMode ? { PGSSLMODE: sslMode } : {}),
    },
  };
}

export async function backupSqlite({
  sourcePath,
  outputPath,
  now = () => new Date(),
}: {
  sourcePath: string;
  outputPath: string;
  now?: () => Date;
}): Promise<BackupManifest> {
  const source = resolve(sourcePath);
  const output = resolve(outputPath);
  assertDistinctPaths(source, output);
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`SQLite source database does not exist: ${source}`);
  }
  requireAbsent(output, 'Backup output');
  requireAbsent(manifestPath(output), 'Backup manifest');
  mkdirSync(dirname(output), { recursive: true });
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    database.exec('PRAGMA busy_timeout = 10000;');
    database.prepare('VACUUM INTO ?').run(output);
  } catch (error) {
    if (existsSync(output)) rmSync(output, { force: true });
    throw error;
  } finally {
    database.close();
  }
  try {
    verifySqliteDatabase(output);
    return await createManifest(output, 'sqlite', 'sqlite-vacuum', now);
  } catch (error) {
    if (existsSync(output)) rmSync(output, { force: true });
    if (existsSync(manifestPath(output))) rmSync(manifestPath(output), { force: true });
    throw error;
  }
}

export async function backupPostgres({
  databaseUrl,
  outputPath,
  now = () => new Date(),
  commandRunner = defaultCommandRunner,
}: {
  databaseUrl: string;
  outputPath: string;
  now?: () => Date;
} & PostgresRecoveryOptions): Promise<BackupManifest> {
  const output = resolve(outputPath);
  requireAbsent(output, 'Backup output');
  requireAbsent(manifestPath(output), 'Backup manifest');
  mkdirSync(dirname(output), { recursive: true });
  const { environment } = postgresConnection(databaseUrl);
  try {
    runTool(
      commandRunner,
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-privileges', `--file=${output}`],
      environment,
    );
    runTool(commandRunner, 'pg_restore', ['--list', output]);
    return await createManifest(output, 'postgresql', 'postgresql-custom', now);
  } catch (error) {
    if (existsSync(output)) rmSync(output, { force: true });
    if (existsSync(manifestPath(output))) rmSync(manifestPath(output), { force: true });
    throw error;
  }
}

export async function verifyBackup({
  backupPath,
  commandRunner = defaultCommandRunner,
}: {
  backupPath: string;
} & PostgresRecoveryOptions): Promise<BackupManifest> {
  const backup = resolve(backupPath);
  if (!existsSync(backup) || !statSync(backup).isFile()) {
    throw new Error(`Backup archive does not exist: ${backup}`);
  }
  const manifest = readManifest(backup);
  const actualSize = statSync(backup).size;
  if (actualSize !== manifest.byteLength) throw new Error('Backup byte length does not match.');
  const actualChecksum = await sha256File(backup);
  if (actualChecksum !== manifest.sha256) throw new Error('Backup checksum does not match.');
  if (manifest.database === 'sqlite') verifySqliteDatabase(backup);
  else runTool(commandRunner, 'pg_restore', ['--list', backup]);
  return manifest;
}

export async function restoreSqlite({
  backupPath,
  targetPath,
}: {
  backupPath: string;
  targetPath: string;
}): Promise<BackupManifest> {
  const backup = resolve(backupPath);
  const target = resolve(targetPath);
  assertDistinctPaths(backup, target);
  requireAbsent(target, 'Restore target');
  const manifest = await verifyBackup({ backupPath: backup });
  if (manifest.database !== 'sqlite') throw new Error('Backup is not a SQLite archive.');
  mkdirSync(dirname(target), { recursive: true });
  try {
    copyFileSync(backup, target, fileConstants.COPYFILE_EXCL);
    chmodSync(target, 0o600);
    verifySqliteDatabase(target);
  } catch (error) {
    if (existsSync(target)) rmSync(target, { force: true });
    throw error;
  }
  return manifest;
}

export async function restorePostgres({
  backupPath,
  targetDatabaseUrl,
  confirmTargetDatabase,
  commandRunner = defaultCommandRunner,
}: {
  backupPath: string;
  targetDatabaseUrl: string;
  confirmTargetDatabase: string;
} & PostgresRecoveryOptions): Promise<BackupManifest> {
  const backup = resolve(backupPath);
  const manifest = await verifyBackup({ backupPath: backup, commandRunner });
  if (manifest.database !== 'postgresql') throw new Error('Backup is not a PostgreSQL archive.');
  const { databaseName, environment } = postgresConnection(targetDatabaseUrl);
  if (confirmTargetDatabase !== databaseName) {
    throw new Error('PostgreSQL restore confirmation does not match the target database name.');
  }
  const existing = runTool(
    commandRunner,
    'psql',
    [
      '--no-psqlrc',
      '--quiet',
      '--tuples-only',
      '--no-align',
      '--command',
      postgresUserRelationCount,
    ],
    environment,
  ).stdout.trim();
  if (existing !== '0') {
    throw new Error('PostgreSQL restore target is not an empty GridStory database.');
  }
  runTool(
    commandRunner,
    'pg_restore',
    [
      '--single-transaction',
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
      '--dbname',
      databaseName,
      backup,
    ],
    environment,
  );
  const probe = runTool(
    commandRunner,
    'psql',
    ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--command', postgresGridStoryProbe],
    environment,
  ).stdout.trim();
  if (probe !== 'ok') throw new Error('Restored PostgreSQL database is missing GridStory tables.');
  return manifest;
}

export const recoveryManifestPath = manifestPath;
