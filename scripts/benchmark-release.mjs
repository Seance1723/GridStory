import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { buildServer } from '../apps/api/dist/server.js';
import { benchmarkReportSchema, resourceLimits } from '../packages/schema/dist/index.js';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function integerArgument(name, fallback) {
  const value = Number(argument(name, String(fallback)));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function rounded(value) {
  return Number(value.toFixed(3));
}

async function measure({ samples, concurrency, operation }) {
  const latencies = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(samples, concurrency) }, async () => {
      while (next < samples) {
        const sample = next;
        next += 1;
        const sampleStarted = performance.now();
        await operation(sample);
        latencies.push(performance.now() - sampleStarted);
      }
    }),
  );
  const elapsedMs = performance.now() - started;
  return {
    samples,
    p50Ms: rounded(percentile(latencies, 50)),
    p95Ms: rounded(percentile(latencies, 95)),
    p99Ms: rounded(percentile(latencies, 99)),
    throughputPerSecond: rounded(samples / (elapsedMs / 1_000)),
  };
}

function assertResponse(response, expected, scenario) {
  if (response.statusCode !== expected) {
    throw new Error(`${scenario} returned ${response.statusCode}: ${response.body}`);
  }
  return response;
}

async function approveForPublication(server, entry, headers) {
  const requester = { ...headers, 'x-gridstory-actor': 'benchmark-requester' };
  assertResponse(
    await server.inject({
      method: 'POST',
      url: `/api/v1/content/${entry.id}/workflow/transitions/submit-review`,
      headers: requester,
      payload: { changedFields: ['title', 'slug', 'story', 'blocks'] },
    }),
    200,
    'workflow submission',
  );
  const approvalRequest = assertResponse(
    await server.inject({
      method: 'POST',
      url: `/api/v1/content/${entry.id}/workflow/transitions/approve`,
      headers: requester,
      payload: { changedFields: ['title', 'slug', 'story', 'blocks'] },
    }),
    200,
    'workflow approval request',
  ).json();
  assertResponse(
    await server.inject({
      method: 'POST',
      url: `/api/v1/content/${entry.id}/workflow/approvals/${approvalRequest.pendingApproval.id}`,
      headers: { ...headers, 'x-gridstory-actor': 'benchmark-reviewer' },
      payload: { decision: 'approved', comment: 'Benchmark fixture approval.' },
    }),
    200,
    'workflow approval',
  );
}

function page(index, title = `Benchmark page ${index}`) {
  return {
    title,
    slug: `benchmark-${index}`,
    story: {
      version: 1,
      blocks: [
        {
          id: `story-${index}`,
          type: 'paragraph',
          content: [{ type: 'text', text: `Benchmark body ${index}.`, marks: [] }],
        },
      ],
    },
    blocks: [
      {
        id: `hero-${index}`,
        component: 'gridstory.hero',
        version: 1,
        props: {
          eyebrow: '',
          heading: title,
          body: `Benchmark body ${index}.`,
          tone: 'indigo',
        },
      },
    ],
  };
}

async function main() {
  const profile = argument('--profile', 'sqlite');
  if (profile !== 'sqlite' && profile !== 'postgres') {
    throw new Error('--profile must be sqlite or postgres.');
  }
  const datasetEntries = integerArgument('--entries', resourceLimits.benchmark.datasetEntries);
  const readSamples = integerArgument('--read-samples', resourceLimits.benchmark.readSamples);
  const writeSamples = integerArgument('--write-samples', resourceLimits.benchmark.writeSamples);
  const concurrency = integerArgument('--concurrency', resourceLimits.benchmark.concurrency);
  const output = resolve(argument('--output', `benchmark-${profile}.json`));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'gridstory-benchmark-'));
  const tenantId = `benchmark-${profile}-${Date.now()}-${process.pid}`;
  const databaseUrl = process.env.GRIDSTORY_BENCHMARK_POSTGRES_URL;
  if (profile === 'postgres' && !databaseUrl) {
    throw new Error('GRIDSTORY_BENCHMARK_POSTGRES_URL is required for the PostgreSQL profile.');
  }
  const server = await buildServer({
    ...(profile === 'sqlite'
      ? { databasePath: join(temporaryDirectory, 'benchmark.db') }
      : { databaseUrl }),
    seed: false,
    logger: false,
  });
  const headers = {
    'content-type': 'application/json',
    'x-gridstory-organization': 'benchmark',
    'x-gridstory-tenant': tenantId,
    'x-gridstory-workspace': 'benchmark',
    'x-gridstory-site': 'benchmark',
    'x-gridstory-environment': 'benchmark',
    'x-gridstory-locale': 'en',
    'x-gridstory-actor': 'benchmark-author',
    'x-gridstory-roles': 'admin',
  };

  try {
    const entries = [];
    for (let index = 0; index < datasetEntries; index += 1) {
      const response = assertResponse(
        await server.inject({
          method: 'POST',
          url: '/api/v1/content',
          headers,
          payload: { contentType: 'page', data: page(index) },
        }),
        201,
        'dataset creation',
      );
      entries.push(response.json());
    }
    const published = entries[0];
    const writable = entries.at(-1);
    if (!published || !writable) throw new Error('Benchmark dataset is empty.');
    await approveForPublication(server, published, headers);
    assertResponse(
      await server.inject({
        method: 'POST',
        url: `/api/v1/content/${published.id}/publish`,
        headers,
        payload: { expectedRevisionId: published.draftRevisionId },
      }),
      200,
      'fixture publication',
    );

    const budget = resourceLimits.benchmark[profile];
    const scenarios = [];
    const scenario = async ({
      name,
      category,
      samples,
      maximumP95Ms,
      operation,
      minimum,
      scenarioConcurrency = concurrency,
    }) => {
      for (let index = 0; index < 5; index += 1) await operation(index);
      const metrics = await measure({ samples, concurrency: scenarioConcurrency, operation });
      const passed =
        metrics.p95Ms <= maximumP95Ms &&
        (minimum === undefined || metrics.throughputPerSecond >= minimum);
      scenarios.push({
        name,
        category,
        metrics,
        maximumP95Ms,
        ...(minimum === undefined ? {} : { minimumThroughputPerSecond: minimum }),
        passed,
      });
    };

    await scenario({
      name: 'published-content-by-slug',
      category: 'read',
      samples: readSamples,
      maximumP95Ms: budget.maximumReadP95Ms,
      minimum: budget.minimumReadThroughputPerSecond,
      operation: async () => {
        assertResponse(
          await server.inject({
            method: 'GET',
            url: '/api/v1/delivery/page/benchmark-0',
            headers,
          }),
          200,
          'published read',
        );
      },
    });
    await scenario({
      name: 'bounded-management-query',
      category: 'query',
      samples: readSamples,
      maximumP95Ms: budget.maximumQueryP95Ms,
      operation: async () => {
        assertResponse(
          await server.inject({
            method: 'POST',
            url: '/api/v1/content/query',
            headers,
            payload: {
              contentType: 'page',
              filter: { path: 'data.title', operator: 'contains', value: 'Benchmark' },
              first: 20,
            },
          }),
          200,
          'management query',
        );
      },
    });
    await scenario({
      name: 'bounded-graphql-query',
      category: 'query',
      samples: readSamples,
      maximumP95Ms: budget.maximumQueryP95Ms,
      operation: async () => {
        const response = assertResponse(
          await server.inject({
            method: 'POST',
            url: '/graphql',
            headers,
            payload: {
              query:
                'query Benchmark { contents(query: { contentType: "page", first: 20 }) { totalCount nodes { id updatedAt } } }',
            },
          }),
          200,
          'GraphQL query',
        );
        if (response.json().errors) throw new Error(`GraphQL query failed: ${response.body}`);
      },
    });

    let revisionId = writable.draftRevisionId;
    let writeIndex = 0;
    await scenario({
      name: 'serial-draft-update',
      category: 'write',
      samples: writeSamples,
      scenarioConcurrency: 1,
      maximumP95Ms: budget.maximumWriteP95Ms,
      operation: async () => {
        writeIndex += 1;
        const response = assertResponse(
          await server.inject({
            method: 'PUT',
            url: `/api/v1/content/${writable.id}/draft`,
            headers,
            payload: {
              expectedRevisionId: revisionId,
              data: page(datasetEntries - 1, `Benchmark update ${writeIndex}`),
            },
          }),
          200,
          'draft update',
        );
        revisionId = response.json().draftRevisionId;
      },
    });

    const peakResidentMemoryBytes = Math.max(
      process.memoryUsage.rss(),
      process.resourceUsage().maxRSS * 1_024,
    );
    const report = benchmarkReportSchema.parse({
      schemaVersion: 1,
      profile,
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        availableParallelism: availableParallelism(),
        totalMemoryBytes: totalmem(),
      },
      dataset: { entries: datasetEntries, tenantId, transport: 'fastify-inject' },
      scenarios,
      peakResidentMemoryBytes,
      maximumPeakResidentMemoryBytes: resourceLimits.benchmark.maximumPeakResidentMemoryBytes,
      passed:
        scenarios.every(({ passed }) => passed) &&
        peakResidentMemoryBytes <= resourceLimits.benchmark.maximumPeakResidentMemoryBytes,
      claimBoundary:
        'Fastify injection measures the GridStory application pipeline only; it excludes network, TLS, proxy, CDN, multi-node coordination, and provider-specific production storage behavior.',
    });
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`${profile} benchmark ${report.passed ? 'passed' : 'failed'}; report: ${output}`);
    if (!report.passed) process.exitCode = 1;
  } finally {
    await server.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

await main();
