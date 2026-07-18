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

    process.exitCode = runPostgresTests(
      `postgresql://gridstory:gridstory@127.0.0.1:${port}/gridstory`,
    );
  } finally {
    if (started) run('docker', ['stop', containerName], { allowFailure: true });
  }
}
