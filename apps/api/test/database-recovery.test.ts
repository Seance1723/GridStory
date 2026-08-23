import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MigrationSourceAdapter } from '@gridstory/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  backupPostgres,
  backupSqlite,
  type RecoveryCommandRunner,
  recoveryManifestPath,
  restorePostgres,
  restoreSqlite,
  verifyBackup,
} from '../src/database-recovery.js';
import { buildServer } from '../src/server.js';

const headers = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'recovery-tenant',
  'x-gridstory-actor': 'recovery-test',
};
const page = {
  title: 'Recovery snapshot',
  slug: 'recovery-snapshot',
  blocks: [
    {
      id: 'recovery-hero',
      component: 'gridstory.hero',
      version: 1,
      props: {
        eyebrow: 'Operations',
        heading: 'Recovery snapshot',
        body: 'Captured before the later edit.',
        tone: 'indigo',
      },
    },
  ],
};
const recoveryMigrationSource: MigrationSourceAdapter = {
  descriptor: {
    id: 'recovery-source',
    provider: 'contentful',
    name: 'Recovery source',
    supportsDelta: true,
    reportsDeletions: true,
    includesAssets: true,
  },
  read: () => ({ kind: 'full', records: [], checkpoint: 'recovery-checkpoint', complete: true }),
};

describe('database recovery', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('snapshots a live WAL database and restores the exact earlier state', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gridstory-recovery-'));
    directories.push(directory);
    const sourcePath = join(directory, 'source.db');
    const backupPath = join(directory, 'backups', 'snapshot.db');
    const restoredPath = join(directory, 'restored.db');
    const server = await buildServer({
      databasePath: sourcePath,
      seed: false,
      migration: { sources: [recoveryMigrationSource] },
    });
    let restored: Awaited<ReturnType<typeof buildServer>> | undefined;
    try {
      const created = (
        await server.inject({
          method: 'POST',
          url: '/api/v1/content',
          headers,
          payload: { contentType: 'page', data: page },
        })
      ).json();
      const governedSubject = (
        await server.inject({
          method: 'POST',
          url: '/api/v1/governance/subjects',
          headers,
          payload: { reference: 'recovery-subject-before-backup' },
        })
      ).json();
      const migrationRecipe = await server.inject({
        method: 'PUT',
        url: '/api/v1/migrations/recipes/recovery-page',
        headers,
        payload: {
          name: 'Recovery page recipe',
          provider: 'contentful',
          sourceType: 'contentful.Entry.page',
          targetContentType: 'page',
          fields: [
            {
              sourcePath: 'fields.title',
              targetField: 'title',
              transform: 'string',
              required: true,
            },
            { sourcePath: 'fields.slug', targetField: 'slug', transform: 'slug', required: true },
          ],
        },
      });
      expect(migrationRecipe.statusCode).toBe(200);
      const migrationProject = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/projects',
        headers,
        payload: {
          id: 'recovery-migration',
          name: 'Recovery migration project',
          sourceId: 'recovery-source',
          recipeIds: ['recovery-page'],
          mode: 'dual-run',
        },
      });
      expect(migrationProject.statusCode).toBe(201);

      const manifest = await backupSqlite({
        sourcePath,
        outputPath: backupPath,
        now: () => new Date('2026-08-21T12:00:00.000Z'),
      });
      expect(manifest).toMatchObject({
        database: 'sqlite',
        format: 'sqlite-vacuum',
        createdAt: '2026-08-21T12:00:00.000Z',
        backupFile: 'snapshot.db',
      });
      expect(manifest.byteLength).toBeGreaterThan(0);
      expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/);

      const update = await server.inject({
        method: 'PUT',
        url: `/api/v1/content/${created.id}/draft`,
        headers,
        payload: {
          expectedRevisionId: created.draftRevisionId,
          data: { ...page, title: 'Edited after backup' },
        },
      });
      expect(update.statusCode).toBe(200);
      await server.inject({
        method: 'POST',
        url: '/api/v1/governance/subjects',
        headers,
        payload: { reference: 'recovery-subject-after-backup' },
      });
      await server.inject({
        method: 'PUT',
        url: '/api/v1/migrations/recipes/recovery-page',
        headers,
        payload: {
          name: 'Changed after backup',
          provider: 'contentful',
          sourceType: 'contentful.Entry.page',
          targetContentType: 'page',
          fields: [
            {
              sourcePath: 'fields.title',
              targetField: 'title',
              transform: 'string',
              required: true,
            },
            { sourcePath: 'fields.slug', targetField: 'slug', transform: 'slug', required: true },
          ],
        },
      });

      await expect(restoreSqlite({ backupPath, targetPath: restoredPath })).resolves.toEqual(
        manifest,
      );
      restored = await buildServer({
        databasePath: restoredPath,
        seed: false,
        migration: { sources: [recoveryMigrationSource] },
      });
      const recovered = await restored.inject({
        method: 'GET',
        url: `/api/v1/content/${created.id}`,
        headers,
      });
      expect(recovered.statusCode).toBe(200);
      expect(recovered.json().data.title).toBe('Recovery snapshot');
      const recoveredGovernance = await restored.inject({
        method: 'GET',
        url: '/api/v1/governance',
        headers,
      });
      expect(recoveredGovernance.statusCode).toBe(200);
      expect(recoveredGovernance.json().subjects).toEqual([
        expect.objectContaining({
          id: governedSubject.id,
          reference: 'recovery-subject-before-backup',
        }),
      ]);
      const recoveredMigrations = await restored.inject({
        method: 'GET',
        url: '/api/v1/migrations',
        headers,
      });
      expect(recoveredMigrations.statusCode).toBe(200);
      expect(recoveredMigrations.json()).toMatchObject({
        recipes: [{ id: 'recovery-page', name: 'Recovery page recipe', version: 1 }],
        projects: [{ id: 'recovery-migration', sourceId: 'recovery-source', state: 'active' }],
      });
    } finally {
      await restored?.close();
      await server.close();
    }
  });

  it('refuses existing targets and detects archive or manifest tampering', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gridstory-recovery-negative-'));
    directories.push(directory);
    const sourcePath = join(directory, 'source.db');
    const backupPath = join(directory, 'snapshot.db');
    const targetPath = join(directory, 'existing.db');
    const server = await buildServer({ databasePath: sourcePath, seed: false });
    await server.close();
    await backupSqlite({ sourcePath, outputPath: backupPath });

    writeFileSync(targetPath, 'do not replace');
    await expect(restoreSqlite({ backupPath, targetPath })).rejects.toThrow(
      /Restore target already exists/,
    );

    appendFileSync(backupPath, 'tampered');
    await expect(verifyBackup({ backupPath })).rejects.toThrow(/byte length does not match/);

    const manifest = JSON.parse(
      await import('node:fs/promises').then(({ readFile }) =>
        readFile(recoveryManifestPath(backupPath), 'utf8'),
      ),
    );
    writeFileSync(
      recoveryManifestPath(backupPath),
      JSON.stringify({ ...manifest, backupFile: 'another.db' }),
    );
    await expect(verifyBackup({ backupPath })).rejects.toThrow(/filename does not match/);
  });

  it('keeps PostgreSQL credentials out of tool arguments and restores only to a confirmed empty target', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gridstory-postgres-recovery-'));
    directories.push(directory);
    const backupPath = join(directory, 'snapshot.dump');
    const calls: Array<{
      command: string;
      args: string[];
      password: string | undefined;
      database: string | undefined;
    }> = [];
    let psqlCall = 0;
    const runner: RecoveryCommandRunner = (command, args, environment) => {
      calls.push({
        command,
        args,
        password: environment?.PGPASSWORD,
        database: environment?.PGDATABASE,
      });
      if (command === 'pg_dump') {
        const output = args.find((argument) => argument.startsWith('--file='))?.slice(7);
        if (!output) throw new Error('Test pg_dump output is missing.');
        writeFileSync(output, 'custom-postgresql-archive');
      }
      if (command === 'psql') {
        psqlCall += 1;
        return { status: 0, stdout: psqlCall === 1 ? '0\n' : 'ok\n', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const sourceUrl = 'postgresql://gridstory:source-secret@database.example:5432/gridstory';
    const manifest = await backupPostgres({
      databaseUrl: sourceUrl,
      outputPath: backupPath,
      commandRunner: runner,
    });
    expect(manifest.database).toBe('postgresql');
    expect(calls[0]).toMatchObject({
      command: 'pg_dump',
      password: 'source-secret',
      database: 'gridstory',
    });
    expect(calls.flatMap((call) => call.args).join(' ')).not.toContain('source-secret');
    expect(calls.flatMap((call) => call.args).join(' ')).not.toContain(sourceUrl);

    const targetUrl = 'postgresql://restore:target-secret@restore.example:5432/gridstory_restore';
    await expect(
      restorePostgres({
        backupPath,
        targetDatabaseUrl: targetUrl,
        confirmTargetDatabase: 'wrong',
        commandRunner: runner,
      }),
    ).rejects.toThrow(/confirmation does not match/);
    await expect(
      restorePostgres({
        backupPath,
        targetDatabaseUrl: targetUrl,
        confirmTargetDatabase: 'gridstory_restore',
        commandRunner: runner,
      }),
    ).resolves.toEqual(manifest);
    const restoreCall = calls.find(
      (call) => call.command === 'pg_restore' && call.args.includes('--dbname'),
    );
    expect(restoreCall).toMatchObject({
      password: 'target-secret',
      database: 'gridstory_restore',
    });
    expect(restoreCall?.args).not.toContain(targetUrl);
    expect(restoreCall?.args).not.toContain('target-secret');
  });
});
