import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function fail(message) {
  console.error(`Ledger validation failed: ${message}`);
  process.exitCode = 1;
}

const tasks = readFileSync('TASKS.md', 'utf8');
const bugs = readFileSync('BUGS.md', 'utf8');
const changelog = readFileSync('CHANGELOG.md', 'utf8');

const taskIds = [...tasks.matchAll(/\*\*([A-Z0-9]+-\d{3})\*\*/g)].map((match) => match[1]);
if (taskIds.length === 0) fail('TASKS.md contains no stable task IDs.');
const duplicateTasks = taskIds.filter((id, index) => taskIds.indexOf(id) !== index);
if (duplicateTasks.length > 0)
  fail(`duplicate task IDs: ${[...new Set(duplicateTasks)].join(', ')}`);

const bugIds = [...bugs.matchAll(/^\| (BUG-\d{4}) \|/gm)].map((match) => match[1]);
const duplicateBugs = bugIds.filter((id, index) => bugIds.indexOf(id) !== index);
if (duplicateBugs.length > 0) fail(`duplicate bug IDs: ${[...new Set(duplicateBugs)].join(', ')}`);

for (const status of tasks.matchAll(/^- \[([^\]])\] \*\*/gm)) {
  if (![' ', '~', 'x', '!'].includes(status[1])) fail(`unknown task status [${status[1]}].`);
}

if (!changelog.includes('## [Unreleased]')) fail('CHANGELOG.md has no Unreleased section.');
for (const category of ['### Added', '### Changed', '### Fixed', '### Security']) {
  if (!changelog.includes(category)) fail(`CHANGELOG.md is missing ${category}.`);
}

if (process.env.GRIDSTORY_VALIDATE_DIFF === '1' && process.env.GITHUB_BASE_REF) {
  const comparison = `origin/${process.env.GITHUB_BASE_REF}...HEAD`;
  const diff = spawnSync('git', ['diff', '--name-only', comparison], { encoding: 'utf8' });
  if (diff.status !== 0) fail(`could not inspect ${comparison}: ${diff.stderr.trim()}`);
  else {
    const changed = diff.stdout.split(/\r?\n/).filter(Boolean);
    const implementationChanged = changed.some(
      (path) =>
        /^(apps|examples|packages|scripts)\//.test(path) ||
        ['package.json', 'pnpm-lock.yaml', 'playwright.config.ts', 'biome.json'].includes(path),
    );
    if (implementationChanged && !changed.includes('TASKS.md')) {
      fail('implementation files changed without TASKS.md.');
    }
    if (implementationChanged && !changed.includes('CHANGELOG.md')) {
      fail('implementation files changed without CHANGELOG.md.');
    }
  }
}

if (!process.exitCode) console.log('GridStory project ledgers are valid.');
