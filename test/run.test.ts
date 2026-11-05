import { afterEach, describe, expect, it } from 'vitest';
import { runOrderly } from '../src/cli/run.js';
import { FAKE_BIN } from './helpers.js';

const config = { timeoutMs: 5_000, maxOutputChars: 10_000 };

afterEach(() => {
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_EXIT;
});

describe('runOrderly', () => {
  it('captures JSON output from a successful call', async () => {
    const result = await runOrderly(FAKE_BIN, ['market-price'], config);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      argv: ['market-price'],
      dryRun: false,
    });
  });

  it('maps a non-zero exit code without throwing', async () => {
    process.env.FAKE_MODE = 'fail';
    process.env.FAKE_EXIT = '4';
    const result = await runOrderly(FAKE_BIN, ['order-place'], config);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain('fake engine rejection');
  });

  it('passes through non-JSON output', async () => {
    process.env.FAKE_MODE = 'non-json';
    const result = await runOrderly(FAKE_BIN, ['auth-list'], config);
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('No keys stored');
  });

  it('terminates a hung command at the timeout', async () => {
    process.env.FAKE_MODE = 'sleep';
    const result = await runOrderly(FAKE_BIN, ['order-place'], {
      timeoutMs: 200,
      maxOutputChars: 10_000,
    });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('truncates large output at the configured cap', async () => {
    const result = await runOrderly(FAKE_BIN, ['symbols'], {
      timeoutMs: 5_000,
      maxOutputChars: 10,
    });
    expect(result.stdout.length).toBe(10);
    expect(result.truncated).toBe(true);
  });

  it('reports a missing binary as an error', async () => {
    const result = await runOrderly(
      '/definitely/not/here/orderly',
      ['market-price'],
      config
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
