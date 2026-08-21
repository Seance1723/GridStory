import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { resourceLimits } from '../packages/schema/dist/index.js';

const packages = [
  ['@gridstory/schema', 'packages/schema'],
  ['@gridstory/client', 'packages/client'],
  ['@gridstory/core', 'packages/core'],
  ['@gridstory/react', 'packages/react'],
  ['@gridstory/example-kit', 'packages/example-kit'],
];

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function outputDirectory() {
  const directory = resolve(argument('--output', 'release-artifacts'));
  const relativePath = relative(process.cwd(), directory);
  if (!relativePath || relativePath.startsWith('..') || relativePath.split(sep).includes('..')) {
    throw new Error('Release output must be a child of the repository root.');
  }
  return directory;
}

function runPnpm(args, capture = false) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Release evidence must be run through a root pnpm script.');
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed.`);
  return result.stdout ?? '';
}

function runTar(args) {
  const result = spawnSync('tar', args, { encoding: 'utf8', stdio: 'pipe' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function validateArchive(path, expectedName) {
  const entries = runTar(['-tf', path]).split(/\r?\n/u).filter(Boolean);
  const normalizedEntries = entries.map((entry) => entry.replace(/^package\//u, ''));
  const allowed = normalizedEntries.every(
    (entry) =>
      entry === 'package.json' ||
      entry === 'LICENSE' ||
      entry === 'README.md' ||
      entry.startsWith('dist/') ||
      (expectedName === '@gridstory/example-kit' && entry === 'src/styles.css'),
  );
  const manifestEntry = entries.find(
    (entry) => entry === 'package.json' || entry === 'package/package.json',
  );
  if (!allowed || !manifestEntry) {
    throw new Error(`${basename(path)} contains a file outside its reviewed package inventory.`);
  }
  const packedManifest = JSON.parse(runTar(['-xOf', path, manifestEntry]));
  if (packedManifest.name !== expectedName || packedManifest.version !== '0.0.0') {
    throw new Error(`${basename(path)} has unexpected package identity or version.`);
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function artifactFiles(directory) {
  return readdirSync(directory)
    .map((name) => join(directory, name))
    .filter((path) => statSync(path).isFile() && basename(path) !== 'release-manifest.json')
    .sort((left, right) => basename(left).localeCompare(basename(right)));
}

function writeManifest(directory) {
  const files = artifactFiles(directory).map((path) => ({
    name: basename(path),
    bytes: statSync(path).size,
    sha256: sha256(path),
  }));
  if (files.length === 0) throw new Error('No release artifacts exist for the manifest.');
  const manifest = { schemaVersion: 1, algorithm: 'sha256', files };
  writeFileSync(
    join(directory, 'release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  console.log(`Wrote SHA-256 manifest for ${files.length} artifacts.`);
}

function verifyManifest(directory) {
  const path = join(directory, 'release-manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.algorithm !== 'sha256') {
    throw new Error('Release manifest format is unsupported.');
  }
  const actualNames = artifactFiles(directory).map((path) => basename(path));
  const expectedNames = manifest.files.map(({ name }) => name);
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error('Release manifest inventory does not match the artifact directory.');
  }
  for (const file of manifest.files) {
    const artifact = join(directory, file.name);
    if (statSync(artifact).size !== file.bytes || sha256(artifact) !== file.sha256) {
      throw new Error(`Release artifact verification failed for ${file.name}.`);
    }
  }
  console.log(`Verified ${manifest.files.length} release artifact checksums.`);
}

function pack(directory) {
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    throw new Error('Release output directory must be empty before preparation.');
  }
  mkdirSync(directory, { recursive: true });
  for (const [name, packageDirectory] of packages) {
    const before = new Set(artifactFiles(directory));
    runPnpm(['--dir', packageDirectory, 'pack', '--pack-destination', directory]);
    const created = artifactFiles(directory).filter((path) => !before.has(path));
    if (created.length !== 1 || !created[0]?.endsWith('.tgz')) {
      throw new Error(`Packing ${name} did not create exactly one archive.`);
    }
    validateArchive(created[0], name);
    console.log(`Packed ${name}.`);
  }
  const archives = artifactFiles(directory).filter((path) => path.endsWith('.tgz'));
  if (archives.length !== packages.length) {
    throw new Error(`Expected ${packages.length} package archives, found ${archives.length}.`);
  }
  writeFileSync(
    join(directory, 'resource-limits.json'),
    `${JSON.stringify(resourceLimits, null, 2)}\n`,
    'utf8',
  );
}

const command = process.argv[2];
const directory = outputDirectory();
if (command === 'prepare') pack(directory);
else if (command === 'manifest') writeManifest(directory);
else if (command === 'verify') verifyManifest(directory);
else throw new Error('Use release-evidence.mjs prepare, manifest, or verify.');
