import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  CliCandidate,
  CliLocation,
  CliSchema,
  DiscoveryResult,
} from '../types.js';
import { cleanEnv, spawnCapture } from './process.js';
import { parseSchema, SchemaError } from './schema.js';

export const MIN_CLI_VERSION = '2.0.1';

const SCHEMA_TIMEOUT_MS = 10_000;
const VERSION_TIMEOUT_MS = 5_000;
const SCHEMA_MAX_CHARS = 8_000_000;

function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .split('.')
      .map((part) => Number.parseInt(part.replace(/\D.*$/, ''), 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function versionAtLeast(version: string, minimum: string): boolean {
  return compareVersions(version, minimum) >= 0;
}

function executableNames(): string[] {
  return process.platform === 'win32' ? ['orderly.exe', 'orderly'] : ['orderly'];
}

function commonDirectories(env: NodeJS.ProcessEnv): string[] {
  const home = homedir();
  const directories = [
    path.join(home, '.local', 'bin'),
    '/usr/local/bin',
    path.join(home, '.cargo', 'bin'),
  ];
  if (process.platform === 'win32') {
    const localAppData =
      env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    directories.push(path.join(localAppData, 'orderly'));
  }
  return directories;
}

function discoverCandidates(env: NodeJS.ProcessEnv): string[] {
  const directories: string[] = [];
  for (const entry of (env.PATH ?? '').split(path.delimiter)) {
    if (entry.trim().length > 0) directories.push(entry);
  }
  directories.push(...commonDirectories(env));

  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const directory of directories) {
    for (const name of executableNames()) {
      const candidate = path.resolve(directory, name);
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      candidates.push(candidate);
    }
  }
  return candidates;
}

function executableError(candidate: string): string | null {
  let stats;
  try {
    stats = statSync(candidate);
  } catch {
    return 'not found';
  }
  if (!stats.isFile()) return 'not a file';
  if (process.platform !== 'win32') {
    try {
      accessSync(candidate, constants.X_OK);
    } catch {
      return 'not executable';
    }
  }
  return null;
}

async function readVersion(
  bin: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  const result = await spawnCapture(bin, ['--version'], {
    timeoutMs: VERSION_TIMEOUT_MS,
    maxOutputChars: 2_000,
    env: cleanEnv(env),
  });
  if (result.error || result.exitCode !== 0) return null;
  const text = `${result.stdout}\n${result.stderr}`.trim();
  const rust = text.match(/orderly\s+(\d+\.\d+\.\d+)/);
  if (rust?.[1]) return rust[1];
  const legacy = text.match(/orderly\/(\d+\.\d+\.\d+)/);
  if (legacy?.[1]) return legacy[1];
  return null;
}

interface ValidatedCandidate {
  candidate: CliCandidate;
  schema?: CliSchema;
  version?: string;
}

async function validateCandidate(
  bin: string,
  env: NodeJS.ProcessEnv
): Promise<ValidatedCandidate> {
  const problem = executableError(bin);
  if (problem === 'not found' || problem === 'not a file') {
    return {
      candidate: { path: bin, status: 'missing', detail: 'not found' },
    };
  }
  if (problem === 'not executable') {
    return {
      candidate: {
        path: bin,
        status: 'not-executable',
        detail: 'exists but is not executable',
      },
    };
  }

  const result = await spawnCapture(bin, ['schema'], {
    timeoutMs: SCHEMA_TIMEOUT_MS,
    maxOutputChars: SCHEMA_MAX_CHARS,
    env: cleanEnv(env),
  });

  if (result.error) {
    return {
      candidate: { path: bin, status: 'missing', detail: result.error },
    };
  }

  if (result.timedOut) {
    return {
      candidate: {
        path: bin,
        status: 'invalid-schema',
        detail: `timed out after ${SCHEMA_TIMEOUT_MS}ms running "orderly schema"`,
      },
    };
  }

  if (result.exitCode !== 0) {
    const version = await readVersion(bin, env);
    const detailText = (result.stderr || result.stdout).trim().slice(0, 300);
    if (result.stderr.includes('Unknown command: schema')) {
      return {
        candidate: {
          path: bin,
          status: version?.startsWith('1.') ? 'legacy' : 'too-old',
          version: version ?? undefined,
          detail: version
            ? `version ${version} has no "schema" command (need >= ${MIN_CLI_VERSION})`
            : 'this CLI has no "schema" command',
        },
      };
    }
    return {
      candidate: {
        path: bin,
        status: 'invalid-schema',
        version: version ?? undefined,
        detail: detailText || `orderly schema exited with code ${result.exitCode}`,
      },
    };
  }

  let schema: CliSchema;
  try {
    schema = parseSchema(result.stdout);
  } catch (error) {
    return {
      candidate: {
        path: bin,
        status: 'invalid-schema',
        detail:
          error instanceof SchemaError
            ? error.message
            : `invalid schema output: ${String(error)}`,
      },
    };
  }

  if (!versionAtLeast(schema.version, MIN_CLI_VERSION)) {
    return {
      candidate: {
        path: bin,
        status: 'too-old',
        version: schema.version,
        detail: `version ${schema.version} is older than ${MIN_CLI_VERSION}`,
      },
      version: schema.version,
    };
  }

  return {
    candidate: {
      path: bin,
      status: 'ok',
      version: schema.version,
      detail: 'schema loaded',
    },
    schema,
    version: schema.version,
  };
}

function buildDiscoveryError(candidates: CliCandidate[]): string {
  const tried =
    candidates.length === 0
      ? 'no candidates found'
      : candidates
          .map(
            (candidate) =>
              `  - ${candidate.path}: ${candidate.detail}${
                candidate.version ? ` (v${candidate.version})` : ''
              }`
          )
          .join('\n');
  return [
    `No compatible "orderly" CLI found (need v${MIN_CLI_VERSION}+).`,
    tried,
    '',
    'Install the CLI:',
    '  curl -fsSL https://orderly.network/cli.sh | sh',
    '',
    'If it is installed outside this process\'s PATH, set ORDERLY_BIN in the',
    'MCP client configuration, for example: "ORDERLY_BIN=/home/you/.local/bin/orderly".',
  ].join('\n');
}

export async function locateCli(
  env: NodeJS.ProcessEnv = process.env
): Promise<DiscoveryResult> {
  const explicit = env.ORDERLY_BIN?.trim();
  const paths = explicit ? [explicit] : discoverCandidates(env);
  const candidates: CliCandidate[] = [];

  for (const candidatePath of paths) {
    const validated = await validateCandidate(candidatePath, env);
    candidates.push(validated.candidate);
    if (validated.schema && validated.version) {
      const location: CliLocation = {
        bin: candidatePath,
        version: validated.version,
        schema: validated.schema,
      };
      return { location, candidates, error: null };
    }
    // An explicit ORDERLY_BIN is authoritative: do not silently fall back.
    if (explicit) break;
  }

  return {
    location: null,
    candidates,
    error: buildDiscoveryError(candidates),
  };
}

export function formatCandidate(candidate: CliCandidate): string {
  const marker = candidate.status === 'ok' ? 'OK  ' : 'FAIL';
  const version = candidate.version ? ` v${candidate.version}` : '';
  return `${marker} ${candidate.path}${version} - ${candidate.detail}`;
}
