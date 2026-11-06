#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const mode = process.env.FAKE_MODE ?? 'ok';

if (args[0] === '--version') {
  process.stdout.write('orderly 2.0.1\n');
  process.exit(0);
}

if (args[0] === 'schema') {
  const here = path.dirname(fileURLToPath(import.meta.url));
  process.stdout.write(readFileSync(path.join(here, 'schema.json'), 'utf8'));
  process.exit(0);
}

if (mode === 'sleep') {
  setTimeout(() => process.exit(0), 10_000);
} else if (mode === 'fail') {
  process.stderr.write('fake engine rejection\n');
  process.exit(Number(process.env.FAKE_EXIT ?? 4));
} else if (mode === 'non-json') {
  process.stdout.write('No keys stored. Run `orderly wallet-add-key` to get started.\n');
} else if (mode === 'multiple-accounts') {
  process.stderr.write(
    'Multiple accounts found. Specify --account in non-interactive mode. Available accounts: 0xabc (EVM)\n'
  );
  process.exit(2);
} else if (mode === 'success-false') {
  process.stdout.write(
    `${JSON.stringify({ success: false, data: { reason: 'nope' } })}\n`
  );
} else {
  process.stdout.write(
    `${JSON.stringify({ argv: args, dryRun: args.includes('--dry-run') })}\n`
  );
}
