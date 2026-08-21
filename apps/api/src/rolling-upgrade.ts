export interface RollingUpgradeResult {
  status: 'compatible';
  current: { health: 'ok'; readiness: 'ready' };
  candidate: { health: 'ok'; readiness: 'ready' };
}

type FetchLike = typeof fetch;

function normalizeBaseUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL.`);
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${label} must be HTTP(S) without credentials, query, or fragment.`);
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error(`${label} must identify the GridStory API origin without a path.`);
  }
  parsed.pathname = '/';
  return parsed;
}

async function readExactJson(
  fetchImpl: FetchLike,
  baseUrl: URL,
  path: '/health' | '/ready',
  expected: Record<string, string>,
  label: string,
  timeoutMs: number,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(new URL(path, baseUrl), {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`${label} ${path} request failed.`, { cause: error });
  }
  if (response.status !== 200)
    throw new Error(`${label} ${path} returned HTTP ${response.status}.`);
  const body = await response.text();
  if (body.length > 1024) throw new Error(`${label} ${path} response exceeded 1024 bytes.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`${label} ${path} did not return JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} ${path} response was not an object.`);
  }
  const record = parsed as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (
    actualKeys.join('\n') !== expectedKeys.join('\n') ||
    expectedKeys.some((key) => record[key] !== expected[key])
  ) {
    throw new Error(`${label} ${path} did not match the GridStory readiness contract.`);
  }
}

export async function checkRollingUpgrade({
  currentBaseUrl,
  candidateBaseUrl,
  timeoutMs = 5_000,
  fetchImpl = fetch,
}: {
  currentBaseUrl: string;
  candidateBaseUrl: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}): Promise<RollingUpgradeResult> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error('Rolling-upgrade timeout must be an integer between 100 and 60000.');
  }
  const current = normalizeBaseUrl(currentBaseUrl, 'Current URL');
  const candidate = normalizeBaseUrl(candidateBaseUrl, 'Candidate URL');
  if (current.href === candidate.href) {
    throw new Error('Current and candidate URLs must identify different instances.');
  }
  await Promise.all([
    readExactJson(
      fetchImpl,
      current,
      '/health',
      { status: 'ok', service: 'gridstory-api' },
      'Current',
      timeoutMs,
    ),
    readExactJson(fetchImpl, current, '/ready', { status: 'ready' }, 'Current', timeoutMs),
    readExactJson(
      fetchImpl,
      candidate,
      '/health',
      { status: 'ok', service: 'gridstory-api' },
      'Candidate',
      timeoutMs,
    ),
    readExactJson(fetchImpl, candidate, '/ready', { status: 'ready' }, 'Candidate', timeoutMs),
  ]);
  return {
    status: 'compatible',
    current: { health: 'ok', readiness: 'ready' },
    candidate: { health: 'ok', readiness: 'ready' },
  };
}
