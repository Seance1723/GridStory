import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { resourceLimits } from '../packages/schema/dist/index.js';

const packages = [
  ['@gridstory/schema', 'packages/schema'],
  ['@gridstory/client', 'packages/client'],
  ['@gridstory/core', 'packages/core'],
  ['@gridstory/react', 'packages/react'],
  ['@gridstory/example-kit', 'packages/example-kit'],
];
const root = process.cwd();
const canonicalLicense = readFileSync(resolve(root, 'LICENSE'), 'utf8');
const rootManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

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

function runPnpm(args, capture = false, cwd = root) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Release evidence must be run through a root pnpm script.');
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
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

function requiredEntry(entries, name, label) {
  const matches = entries.filter((entry) => entry.normalized === name);
  if (matches.length !== 1) {
    throw new Error(`${label} must contain exactly one ${name}.`);
  }
  return matches[0].original;
}

function validateArchiveData({ entries, expectedName, label, license, manifest, readme }) {
  const normalizedPaths = entries.map(({ normalized }) => normalized);
  if (new Set(normalizedPaths).size !== normalizedPaths.length) {
    throw new Error(`${label} contains duplicate normalized package paths.`);
  }
  const allowed = normalizedPaths.every(
    (entry) =>
      entry === 'package.json' ||
      entry === 'LICENSE' ||
      entry === 'README.md' ||
      entry.startsWith('dist/') ||
      (expectedName === '@gridstory/example-kit' && entry === 'src/styles.css'),
  );
  if (!allowed) {
    throw new Error(`${label} contains a file outside its reviewed package inventory.`);
  }
  for (const required of ['package.json', 'README.md', 'LICENSE']) {
    requiredEntry(entries, required, label);
  }
  if (manifest.name !== expectedName || manifest.version !== '0.0.0') {
    throw new Error(`${label} has unexpected package identity or version.`);
  }
  if (manifest.license !== 'Apache-2.0') {
    throw new Error(`${label} must declare license Apache-2.0.`);
  }
  for (const section of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [dependency, value] of Object.entries(manifest[section] ?? {})) {
      if (typeof value === 'string' && value.startsWith('workspace:')) {
        throw new Error(`${label} retains a workspace dependency in ${section}.`);
      }
      if (dependency.startsWith('@gridstory/') && value !== '0.0.0') {
        throw new Error(`${label} has an unexpected internal package version in ${section}.`);
      }
    }
  }
  if (
    !readme.startsWith(`# ${expectedName}\n`) ||
    !readme.includes('## Install') ||
    !readme.includes('## Public export') ||
    readme.trim().length < 300
  ) {
    throw new Error(`${label} has missing or incomplete package-specific README guidance.`);
  }
  if (license !== canonicalLicense) {
    throw new Error(`${label} license text does not match the canonical repository LICENSE.`);
  }
}

function validateArchive(path, expectedName) {
  const label = basename(path);
  const originalEntries = runTar(['-tf', path]).split(/\r?\n/u).filter(Boolean);
  const entries = originalEntries.map((original) => ({
    original,
    normalized: original.replace(/^package\//u, ''),
  }));
  const manifestEntry = requiredEntry(entries, 'package.json', label);
  const readmeEntry = requiredEntry(entries, 'README.md', label);
  const licenseEntry = requiredEntry(entries, 'LICENSE', label);
  const manifest = JSON.parse(runTar(['-xOf', path, manifestEntry]));
  const readme = runTar(['-xOf', path, readmeEntry]);
  const license = runTar(['-xOf', path, licenseEntry]);
  validateArchiveData({ entries, expectedName, label, license, manifest, readme });
  return { manifest, name: expectedName, path };
}

function expectValidationFailure(name, input, expectedPattern) {
  try {
    validateArchiveData(input);
  } catch (error) {
    if (error instanceof Error && expectedPattern.test(error.message)) return;
    throw error;
  }
  throw new Error(`Release archive negative self-test did not reject ${name}.`);
}

function validatorSelfTest() {
  const expectedName = '@gridstory/schema';
  const base = {
    entries: ['package.json', 'README.md', 'LICENSE', 'dist/index.js'].map((entry) => ({
      normalized: entry,
      original: `package/${entry}`,
    })),
    expectedName,
    label: 'self-test.tgz',
    license: canonicalLicense,
    manifest: {
      dependencies: { zod: '4.4.3' },
      exports: { '.': './dist/index.js' },
      license: 'Apache-2.0',
      name: expectedName,
      version: '0.0.0',
    },
    readme: `# ${expectedName}\n\n${'Canonical contracts. '.repeat(20)}\n\n## Install\n\nInstall.\n\n## Public exports\n\nExports.\n`,
  };
  validateArchiveData(base);
  const cases = [
    [
      'a missing README',
      { ...base, entries: base.entries.filter(({ normalized }) => normalized !== 'README.md') },
      /exactly one README\.md/u,
    ],
    [
      'a missing license file',
      { ...base, entries: base.entries.filter(({ normalized }) => normalized !== 'LICENSE') },
      /exactly one LICENSE/u,
    ],
    [
      'a duplicate metadata path',
      { ...base, entries: [...base.entries, base.entries[1]] },
      /duplicate normalized/u,
    ],
    [
      'an unexpected path',
      {
        ...base,
        entries: [...base.entries, { normalized: '.env', original: 'package/.env' }],
      },
      /outside its reviewed/u,
    ],
    [
      'an incorrect package identity',
      { ...base, manifest: { ...base.manifest, name: '@gridstory/not-schema' } },
      /identity or version/u,
    ],
    [
      'a missing SPDX license',
      { ...base, manifest: { ...base.manifest, license: undefined } },
      /declare license/u,
    ],
    [
      'a workspace dependency',
      {
        ...base,
        manifest: { ...base.manifest, dependencies: { '@gridstory/core': 'workspace:*' } },
      },
      /workspace dependency/u,
    ],
    [
      'an incorrect internal package version',
      {
        ...base,
        manifest: { ...base.manifest, dependencies: { '@gridstory/core': '^1.0.0' } },
      },
      /internal package version/u,
    ],
    [
      'an unrelated README',
      { ...base, readme: base.readme.replace(expectedName, '@gridstory/other') },
      /README guidance/u,
    ],
    [
      'mismatched license bytes',
      { ...base, license: `${canonicalLicense}\nchanged` },
      /canonical repository LICENSE/u,
    ],
  ];
  for (const [name, input, expectedPattern] of cases) {
    expectValidationFailure(name, input, expectedPattern);
  }
  console.log(`Release archive validator passed ${cases.length} negative self-tests.`);
}

function isWithin(parent, target) {
  const path = relative(resolve(parent), resolve(target));
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function packageSpecifier(name, exportPath) {
  return exportPath === '.' ? name : `${name}${exportPath.slice(1)}`;
}

function archiveSpecifier(path) {
  return `file:${resolve(path).replaceAll('\\', '/')}`;
}

function runNode(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`node ${args.join(' ')} failed.`);
}

function verifyInstalledConsumer(archives) {
  const temporaryRoot = resolve(tmpdir());
  const consumerRoot = mkdtempSync(join(temporaryRoot, 'gridstory-release-consumer-'));
  if (!isWithin(temporaryRoot, consumerRoot) || isWithin(root, consumerRoot)) {
    throw new Error('Release consumer must be isolated under the operating system temporary root.');
  }
  try {
    const gridStoryDependencies = Object.fromEntries(
      archives.map(({ name, path }) => [name, archiveSpecifier(path)]),
    );
    const reactManifest = JSON.parse(
      readFileSync(resolve(root, 'packages/react/package.json'), 'utf8'),
    );
    const consumerManifest = {
      name: 'gridstory-release-consumer',
      version: '0.0.0',
      private: true,
      type: 'module',
      packageManager: rootManifest.packageManager,
      dependencies: {
        ...gridStoryDependencies,
        react: reactManifest.devDependencies.react,
      },
      devDependencies: {
        '@types/node': rootManifest.devDependencies['@types/node'],
        '@types/react': rootManifest.devDependencies['@types/react'],
      },
      pnpm: {
        overrides: gridStoryDependencies,
      },
    };
    writeFileSync(
      join(consumerRoot, 'package.json'),
      `${JSON.stringify(consumerManifest, null, 2)}\n`,
      'utf8',
    );

    runPnpm(
      ['install', '--offline', '--ignore-scripts', '--frozen-lockfile=false'],
      false,
      consumerRoot,
    );
    const lockfile = readFileSync(join(consumerRoot, 'pnpm-lock.yaml'), 'utf8');
    if (lockfile.includes('workspace:') || lockfile.includes('link:')) {
      throw new Error('Isolated release consumer resolved a workspace or link dependency.');
    }

    const exports = archives.flatMap(({ manifest, name }) =>
      Object.keys(manifest.exports ?? {}).map((exportPath) => ({
        exportPath,
        specifier: packageSpecifier(name, exportPath),
      })),
    );
    const styleSpecifiers = exports
      .filter(({ exportPath }) => exportPath.endsWith('.css'))
      .map(({ specifier }) => specifier);
    const moduleSpecifiers = exports
      .filter(({ exportPath }) => !exportPath.endsWith('.css'))
      .map(({ specifier }) => specifier);
    if (moduleSpecifiers.length === 0 || styleSpecifiers.length !== 1) {
      throw new Error(
        'Reviewed package exports did not produce the expected module/style inventory.',
      );
    }

    const runtimeSource = `import { readFile } from 'node:fs/promises';\n\nconst modules = ${JSON.stringify(moduleSpecifiers)};\nfor (const specifier of modules) {\n  await import(specifier);\n}\nconst styles = ${JSON.stringify(styleSpecifiers)};\nfor (const specifier of styles) {\n  const url = import.meta.resolve(specifier);\n  const content = await readFile(new URL(url), 'utf8');\n  if (content.trim().length === 0) throw new Error(\`Empty stylesheet export: \${specifier}\`);\n}\nconsole.log(\`Resolved \${modules.length} JavaScript exports and \${styles.length} stylesheet export.\`);\n`;
    writeFileSync(join(consumerRoot, 'consumer.mjs'), runtimeSource, 'utf8');
    runNode(['consumer.mjs'], consumerRoot);

    const typeImports = moduleSpecifiers
      .map((specifier, index) => `import * as module${index} from ${JSON.stringify(specifier)};`)
      .join('\n');
    const typeReferences = moduleSpecifiers.map((_, index) => `module${index}`).join(', ');
    writeFileSync(
      join(consumerRoot, 'consumer.ts'),
      `${typeImports}\n\nvoid [${typeReferences}];\n`,
      'utf8',
    );
    writeFileSync(
      join(consumerRoot, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true,
            skipLibCheck: false,
            strict: true,
            target: 'ES2022',
            types: ['node', 'react'],
          },
          include: ['consumer.ts'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    runNode(
      [resolve(root, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
      consumerRoot,
    );
    console.log(
      `Installed and verified ${archives.length} package archives in an offline consumer.`,
    );
  } finally {
    rmSync(consumerRoot, { force: true, recursive: true });
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
  const packedArchives = [];
  for (const [name, packageDirectory] of packages) {
    const before = new Set(artifactFiles(directory));
    runPnpm(['--dir', packageDirectory, 'pack', '--pack-destination', directory]);
    const created = artifactFiles(directory).filter((path) => !before.has(path));
    if (created.length !== 1 || !created[0]?.endsWith('.tgz')) {
      throw new Error(`Packing ${name} did not create exactly one archive.`);
    }
    packedArchives.push(validateArchive(created[0], name));
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
  verifyInstalledConsumer(packedArchives);
}

const command = process.argv[2];
if (command === 'self-test') validatorSelfTest();
else if (command === 'prepare') {
  validatorSelfTest();
  pack(outputDirectory());
} else if (command === 'manifest') writeManifest(outputDirectory());
else if (command === 'verify') verifyManifest(outputDirectory());
else throw new Error('Use release-evidence.mjs prepare, manifest, or verify.');
