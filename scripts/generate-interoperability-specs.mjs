import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createInteroperabilitySpecifications,
  interoperabilityExamples,
} from '../packages/schema/dist/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'specifications', 'v1');
const mode = process.argv.includes('--write')
  ? 'write'
  : process.argv.includes('--check')
    ? 'check'
    : '';

if (!mode) {
  throw new Error('Use --write to generate interoperability files or --check to verify drift.');
}

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const expectedFiles = new Map();

for (const specification of createInteroperabilitySpecifications()) {
  expectedFiles.set(
    resolve(outputDirectory, specification.filename),
    serialize(specification.schema),
  );
  expectedFiles.set(
    resolve(outputDirectory, `${specification.kind}.example.json`),
    serialize(interoperabilityExamples[specification.kind]),
  );
}

await mkdir(outputDirectory, { recursive: true });

if (mode === 'write') {
  for (const [filename, contents] of expectedFiles) await writeFile(filename, contents, 'utf8');
  console.log(`Generated ${expectedFiles.size} interoperability files in specifications/v1.`);
} else {
  const drifted = [];
  for (const [filename, contents] of expectedFiles) {
    const existing = await readFile(filename, 'utf8').catch(() => undefined);
    if (existing !== contents) drifted.push(filename.slice(root.length + 1));
  }
  if (drifted.length > 0) {
    throw new Error(`Interoperability specification drift: ${drifted.join(', ')}`);
  }
  console.log(`Verified ${expectedFiles.size} generated interoperability files.`);
}
