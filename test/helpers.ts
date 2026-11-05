import { chmodSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CliSchema, SchemaCommand } from '../src/types.js';

export const FIXTURE_SCHEMA_PATH = fileURLToPath(
  new URL('./fixtures/schema.json', import.meta.url)
);
export const FAKE_BIN = fileURLToPath(
  new URL('./fixtures/fake-orderly.mjs', import.meta.url)
);
export const DIST_INDEX = fileURLToPath(
  new URL('../dist/index.js', import.meta.url)
);

// The fake CLI is spawned directly, so it needs the executable bit even on a
// fresh checkout where git may not preserve the mode.
chmodSync(FAKE_BIN, 0o755);

export const fixtureSchema: CliSchema = JSON.parse(
  readFileSync(FIXTURE_SCHEMA_PATH, 'utf8')
) as CliSchema;

export function command(path: string): SchemaCommand {
  const found = fixtureSchema.commands.find((cmd) => cmd.path === path);
  if (!found) throw new Error(`missing fixture command: ${path}`);
  return found;
}

export function stringEnv(
  extra: Record<string, string | undefined>
): Record<string, string> {
  const merged = { ...process.env, ...extra };
  return Object.fromEntries(
    Object.entries(merged).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}
