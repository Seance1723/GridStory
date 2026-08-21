import { checkRollingUpgrade } from './rolling-upgrade.js';

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error('Rolling-upgrade flags must use --name value pairs.');
    }
    if (flags.has(key)) throw new Error(`Rolling-upgrade flag is duplicated: ${key}.`);
    flags.set(key, value);
  }
  return flags;
}

function requiredFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)?.trim();
  if (!value) throw new Error(`Missing required flag: ${name}.`);
  return value;
}

try {
  const flags = parseFlags(process.argv.slice(2));
  const timeout = flags.get('--timeout-ms');
  const result = await checkRollingUpgrade({
    currentBaseUrl: requiredFlag(flags, '--current'),
    candidateBaseUrl: requiredFlag(flags, '--candidate'),
    ...(timeout ? { timeoutMs: Number(timeout) } : {}),
  });
  console.log(JSON.stringify(result));
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown rolling-upgrade failure.';
  console.error(`GridStory rolling-upgrade check failed: ${message}`);
  process.exitCode = 1;
}
