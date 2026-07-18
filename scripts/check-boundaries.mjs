import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageRoot = join(root, 'packages');
const allowedWorkspaceDependencies = new Map([
  ['@gridstory/schema', new Set()],
  ['@gridstory/core', new Set(['@gridstory/schema'])],
  ['@gridstory/client', new Set(['@gridstory/schema'])],
  ['@gridstory/react', new Set(['@gridstory/schema'])],
  ['@gridstory/example-kit', new Set(['@gridstory/react', '@gridstory/schema'])],
]);
const browserSafePackages = new Set([
  '@gridstory/schema',
  '@gridstory/client',
  '@gridstory/react',
  '@gridstory/example-kit',
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

function workspacePackageName(specifier) {
  if (!specifier.startsWith('@gridstory/')) return null;
  return specifier.split('/').slice(0, 2).join('/');
}

const failures = [];
for (const directoryName of await readdir(packageRoot)) {
  const directory = join(packageRoot, directoryName);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const allowed = allowedWorkspaceDependencies.get(manifest.name);
  if (!allowed) {
    failures.push(`${manifest.name}: package has no explicit architecture boundary rule.`);
    continue;
  }

  const dependencies = {
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  };
  for (const dependency of Object.keys(dependencies)) {
    if (dependency.startsWith('@gridstory/') && !allowed.has(dependency)) {
      failures.push(
        `${manifest.name}: workspace dependency ${dependency} is not allowed by its layer.`,
      );
    }
  }

  for (const file of await sourceFiles(join(directory, 'src'))) {
    const source = await readFile(file, 'utf8');
    const specifiers = [...source.matchAll(/\b(?:from|import)\s*(?:\(|)\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1],
    );
    for (const specifier of specifiers) {
      if (!specifier) continue;
      const workspaceDependency = workspacePackageName(specifier);
      if (
        workspaceDependency &&
        workspaceDependency !== manifest.name &&
        !allowed.has(workspaceDependency)
      ) {
        failures.push(
          `${relative(root, file)}: ${manifest.name} cannot import ${workspaceDependency}.`,
        );
      }
      if (browserSafePackages.has(manifest.name) && specifier.startsWith('node:')) {
        failures.push(
          `${relative(root, file)}: browser-safe package ${manifest.name} cannot import ${specifier}.`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error('GridStory package-boundary violations:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('GridStory package boundaries are valid.');
}
