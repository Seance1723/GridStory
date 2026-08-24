import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? 'pipe' : 'inherit',
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  }
  return result;
}

function runPackageTest(packageName, connectionString) {
  const packageManagerCli = process.env.npm_execpath;
  if (!packageManagerCli) {
    throw new Error('The PostgreSQL harness must be run through the pnpm test:postgres script.');
  }
  const result = run(
    process.execPath,
    [packageManagerCli, '--filter', packageName, 'test:postgres'],
    {
      allowFailure: true,
      env: { ...process.env, GRIDSTORY_TEST_POSTGRES_URL: connectionString },
    },
  );
  return result.status ?? 1;
}

function runPostgresTests(connectionString) {
  const coreStatus = runPackageTest('@gridstory/core', connectionString);
  const apiStatus = runPackageTest('@gridstory/api', connectionString);
  return coreStatus || apiStatus;
}

function runPostgresRecoveryDrill(containerName) {
  const archive = `/tmp/gridstory-recovery-${process.pid}.dump`;
  const targetDatabase = `gridstory_recovery_${process.pid}`;
  try {
    run('docker', [
      'exec',
      containerName,
      'pg_dump',
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      `--file=${archive}`,
      '--username=gridstory',
      '--dbname=gridstory',
    ]);
    run('docker', ['exec', containerName, 'pg_restore', '--list', archive]);
    run('docker', [
      'exec',
      containerName,
      'psql',
      '--username=gridstory',
      '--dbname=gridstory',
      '--set=ON_ERROR_STOP=1',
      '--command',
      "DELETE FROM gridstory.entries WHERE tenant_id = 'postgres-tenant';",
    ]);
    const mutated = run(
      'docker',
      [
        'exec',
        containerName,
        'psql',
        '--username=gridstory',
        '--dbname=gridstory',
        '--tuples-only',
        '--no-align',
        '--command',
        "SELECT count(*) FROM gridstory.entries WHERE tenant_id = 'postgres-tenant';",
      ],
      { capture: true },
    );
    if (mutated.stdout.trim() !== '0') {
      throw new Error('PostgreSQL recovery drill could not isolate the post-backup mutation.');
    }
    run('docker', [
      'exec',
      containerName,
      'createdb',
      '--username=gridstory',
      '--owner=gridstory',
      targetDatabase,
    ]);
    run('docker', [
      'exec',
      containerName,
      'pg_restore',
      '--single-transaction',
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
      '--username=gridstory',
      `--dbname=${targetDatabase}`,
      archive,
    ]);
    const restored = run(
      'docker',
      [
        'exec',
        containerName,
        'psql',
        '--username=gridstory',
        `--dbname=${targetDatabase}`,
        '--tuples-only',
        '--no-align',
        '--command',
        "SELECT count(*) FROM gridstory.entries WHERE tenant_id = 'postgres-tenant' AND published_revision_id IS NOT NULL;",
      ],
      { capture: true },
    );
    if (restored.stdout.trim() !== '1') {
      throw new Error('PostgreSQL restore did not recover the published API fixture.');
    }
    const restoredPersonalization = run(
      'docker',
      [
        'exec',
        containerName,
        'psql',
        '--username=gridstory',
        `--dbname=${targetDatabase}`,
        '--tuples-only',
        '--no-align',
        '--command',
        "SELECT count(*) FROM gridstory.gridstory_personalization_documents WHERE tenant_id = 'postgres-tenant' AND payload ? 'published' AND jsonb_array_length(payload->'experiments') = 1 AND payload->'experiments'->0->>'state' = 'running';",
      ],
      { capture: true },
    );
    if (restoredPersonalization.stdout.trim() !== '1') {
      throw new Error(
        'PostgreSQL restore did not recover the published targeting and running experiment fixture.',
      );
    }
    const restoredAnalytics = run(
      'docker',
      [
        'exec',
        containerName,
        'psql',
        '--username=gridstory',
        `--dbname=${targetDatabase}`,
        '--tuples-only',
        '--no-align',
        '--command',
        "SELECT count(*) FROM gridstory.gridstory_analytics_documents WHERE tenant_id = 'postgres-tenant' AND payload->'eventCounts'->>'content.created' = '1';",
      ],
      { capture: true },
    );
    if (restoredAnalytics.stdout.trim() !== '1') {
      throw new Error('PostgreSQL restore did not recover the bounded analytics aggregate.');
    }
    const restoredAiGateway = run(
      'docker',
      [
        'exec',
        containerName,
        'psql',
        '--username=gridstory',
        `--dbname=${targetDatabase}`,
        '--tuples-only',
        '--no-align',
        '--command',
        "SELECT count(*) FROM gridstory.gridstory_ai_gateway_documents WHERE tenant_id = 'postgres-tenant' AND payload->>'state' = 'enabled' AND payload->'activePrompts'->0->>'promptId' = 'postgres-summary';",
      ],
      { capture: true },
    );
    if (restoredAiGateway.stdout.trim() !== '1') {
      throw new Error('PostgreSQL restore did not recover the governed AI gateway policy.');
    }
    const restoredAiAuthoring = run(
      'docker',
      [
        'exec',
        containerName,
        'psql',
        '--username=gridstory',
        `--dbname=${targetDatabase}`,
        '--tuples-only',
        '--no-align',
        '--command',
        "SELECT count(*) FROM gridstory.gridstory_ai_authoring_documents WHERE tenant_id = 'postgres-tenant' AND payload->>'state' = 'enabled' AND payload->'actions'->0->>'id' = 'postgres-title';",
      ],
      { capture: true },
    );
    if (restoredAiAuthoring.stdout.trim() !== '1') {
      throw new Error('PostgreSQL restore did not recover the reviewed AI authoring policy.');
    }
    const restoredRegional = run(
      'docker',
      [
        'exec',
        containerName,
        'psql',
        '--username=gridstory',
        `--dbname=${targetDatabase}`,
        '--tuples-only',
        '--no-align',
        '--command',
        "SELECT count(*) FROM gridstory.gridstory_regional_documents WHERE tenant_id = 'postgres-tenant' AND payload->>'state' = 'enabled' AND payload->>'activeControlRegion' = 'local' AND payload->'readPolicy'->>'mode' = 'primary-only';",
      ],
      { capture: true },
    );
    if (restoredRegional.stdout.trim() !== '1') {
      throw new Error('PostgreSQL restore did not recover the regional topology policy.');
    }
    const restoredFederation = run(
      'docker',
      [
        'exec',
        containerName,
        'psql',
        '--username=gridstory',
        `--dbname=${targetDatabase}`,
        '--tuples-only',
        '--no-align',
        '--command',
        "SELECT count(*) FROM gridstory.gridstory_content_federation_documents WHERE tenant_id = 'postgres-tenant' AND payload->>'version' = '1' AND payload->>'updatedBy' = 'postgres-federation-admin';",
      ],
      { capture: true },
    );
    if (restoredFederation.stdout.trim() !== '1') {
      throw new Error('PostgreSQL restore did not recover the content federation state.');
    }
    const restoredKnowledge = run(
      'docker',
      [
        'exec',
        containerName,
        'psql',
        '--username=gridstory',
        `--dbname=${targetDatabase}`,
        '--tuples-only',
        '--no-align',
        '--command',
        "SELECT count(*) FROM gridstory.gridstory_knowledge_documents WHERE tenant_id = 'postgres-tenant' AND payload->>'version' = '1' AND payload->'policy'->>'enabled' = 'false';",
      ],
      { capture: true },
    );
    if (restoredKnowledge.stdout.trim() !== '1') {
      throw new Error('PostgreSQL restore did not recover the knowledge agent policy.');
    }
    console.log(
      'PostgreSQL logical backup/restore drill passed (published content, targeting, experiment lifecycle, analytics aggregate, governed AI policy, reviewed AI authoring policy, regional topology, content federation state, and knowledge agent policy recovered).',
    );
  } finally {
    run(
      'docker',
      [
        'exec',
        containerName,
        'dropdb',
        '--if-exists',
        '--force',
        '--username=gridstory',
        targetDatabase,
      ],
      { allowFailure: true },
    );
    run('docker', ['exec', containerName, 'rm', '-f', archive], { allowFailure: true });
  }
}

if (process.env.GRIDSTORY_TEST_POSTGRES_URL) {
  process.exitCode = runPostgresTests(process.env.GRIDSTORY_TEST_POSTGRES_URL);
} else {
  const containerName = `gridstory-postgres-test-${process.pid}`;
  let started = false;
  try {
    run('docker', [
      'run',
      '--detach',
      '--rm',
      '--name',
      containerName,
      '--env',
      'POSTGRES_USER=gridstory',
      '--env',
      'POSTGRES_PASSWORD=gridstory',
      '--env',
      'POSTGRES_DB=gridstory',
      '--publish',
      '127.0.0.1::5432',
      'postgres:17-alpine',
    ]);
    started = true;

    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const check = run(
        'docker',
        ['exec', containerName, 'pg_isready', '--username', 'gridstory', '--dbname', 'gridstory'],
        { allowFailure: true, capture: true },
      );
      if (check.status === 0) {
        ready = true;
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    if (!ready) throw new Error('Disposable PostgreSQL did not become ready within 30 seconds.');

    const portResult = run('docker', ['port', containerName, '5432/tcp'], { capture: true });
    const port = portResult.stdout.trim().match(/:(\d+)$/)?.[1];
    if (!port)
      throw new Error(`Could not determine the PostgreSQL port: ${portResult.stdout.trim()}`);

    const testStatus = runPostgresTests(
      `postgresql://gridstory:gridstory@127.0.0.1:${port}/gridstory`,
    );
    if (testStatus === 0) runPostgresRecoveryDrill(containerName);
    process.exitCode = testStatus;
  } finally {
    if (started) run('docker', ['stop', containerName], { allowFailure: true });
  }
}
