import { describe, expect, it } from 'vitest';
import type { RunResult } from '../src/cli/run.js';
import type { ServerConfig } from '../src/config.js';
import { formatRunResult } from '../src/output.js';

const config: ServerConfig = {
  profile: 'core',
  readOnly: false,
  network: null,
  allowMainnet: true,
  timeoutMs: 30_000,
  maxOutputChars: 65_536,
  debug: false,
};

function run(overrides: Partial<RunResult>): RunResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    signal: null,
    timedOut: false,
    truncated: false,
    error: null,
    durationMs: 1,
    ok: true,
    ...overrides,
  };
}

function text(result: ReturnType<typeof formatRunResult>): string {
  return result.content[0]?.text ?? '';
}

describe('formatRunResult', () => {
  it('compacts successful JSON output', () => {
    const result = formatRunResult(
      run({ stdout: '{\n  "ok": true\n}\n' }),
      config
    );
    expect(result.isError).toBeUndefined();
    expect(text(result)).toBe('{"ok":true}');
  });

  it('turns truncated output into an actionable error instead of partial JSON', () => {
    const result = formatRunResult(
      run({ stdout: '{"rows":[{"open":1', truncated: true }),
      config
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('exceeded 65536 characters');
    expect(text(result)).toContain('Narrow the query');
  });

  it('flags partial batch failures', () => {
    const result = formatRunResult(
      run({
        stdout: JSON.stringify({
          rows: [
            { success: true, order_id: 1 },
            { success: false, error_message: 'price scope' },
          ],
        }),
      }),
      config
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('1 of 2 item(s) failed');
    expect(text(result)).toContain('price scope');
  });

  it('does not label API rejections as invalid arguments', () => {
    const result = formatRunResult(
      run({
        exitCode: 2,
        stderr:
          'API Error [400] [-1103] : The order does not meet the price scope requirement.',
      }),
      config
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('The API rejected the request');
    expect(text(result)).not.toContain('Invalid arguments');
  });

  it('does not suggest doctor for business errors', () => {
    const result = formatRunResult(
      run({
        exitCode: 1,
        stderr: 'No open position found for PERP_ETH_USDC',
      }),
      config
    );
    expect(result.isError).toBe(true);
    expect(text(result)).not.toContain('doctor');
  });

  it('keeps the invalid-arguments hint for usage errors', () => {
    const result = formatRunResult(
      run({ exitCode: 2, stderr: 'Invalid short form.' }),
      config
    );
    expect(text(result)).toContain('Invalid arguments');
  });
});
