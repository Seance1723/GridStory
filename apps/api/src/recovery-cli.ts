import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import {
  backupPostgres,
  backupSqlite,
  restorePostgres,
  restoreSqlite,
  verifyBackup,
} from './database-recovery.js';

function parseArguments(args: string[]): { command: string; flags: Map<string, string> } {
  const [command, ...rest] = args;
  if (!command || !['backup', 'restore', 'verify'].includes(command)) {
    throw new Error('Usage: recovery-cli <backup|restore|verify> [--name value].');
  }
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error('Recovery flags must use --name value pairs.');
    }
    if (flags.has(key)) throw new Error(`Recovery flag is duplicated: ${key}.`);
    flags.set(key, value);
  }
  return { command, flags };
}

function requiredFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)?.trim();
  if (!value) throw new Error(`Missing required flag: ${name}.`);
  return value;
}

async function run(): Promise<void> {
  const { command, flags } = parseArguments(process.argv.slice(2));
  if (command === 'backup') {
    const outputPath = resolve(requiredFlag(flags, '--output'));
    const config = loadConfig();
    const manifest = config.databaseUrl
      ? await backupPostgres({ databaseUrl: config.databaseUrl, outputPath })
      : await backupSqlite({ sourcePath: config.databasePath, outputPath });
    console.log(JSON.stringify({ status: 'created', outputPath, manifest }));
    return;
  }
  const backupPath = resolve(requiredFlag(flags, '--backup'));
  if (command === 'verify') {
    const manifest = await verifyBackup({ backupPath });
    console.log(JSON.stringify({ status: 'verified', backupPath, manifest }));
    return;
  }
  const manifest = await verifyBackup({ backupPath });
  if (manifest.database === 'sqlite') {
    const targetPath = resolve(requiredFlag(flags, '--target'));
    await restoreSqlite({ backupPath, targetPath });
    console.log(JSON.stringify({ status: 'restored', targetPath, manifest }));
    return;
  }
  const targetDatabaseUrl = process.env.GRIDSTORY_RECOVERY_TARGET_DATABASE_URL?.trim();
  if (!targetDatabaseUrl) {
    throw new Error('GRIDSTORY_RECOVERY_TARGET_DATABASE_URL is required for PostgreSQL restore.');
  }
  const confirmTargetDatabase = requiredFlag(flags, '--confirm-target');
  await restorePostgres({
    backupPath,
    targetDatabaseUrl,
    confirmTargetDatabase,
  });
  console.log(
    JSON.stringify({ status: 'restored', targetDatabase: confirmTargetDatabase, manifest }),
  );
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown recovery failure.';
  console.error(`GridStory recovery failed: ${message}`);
  process.exitCode = 1;
}
