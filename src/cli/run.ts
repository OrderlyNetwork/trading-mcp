import type { ServerConfig } from '../config.js';
import { cleanEnv, spawnCapture, type CaptureResult } from './process.js';

export interface RunResult extends CaptureResult {
  ok: boolean;
}

export async function runOrderly(
  bin: string,
  argv: string[],
  config: Pick<ServerConfig, 'timeoutMs' | 'maxOutputChars'>
): Promise<RunResult> {
  const result = await spawnCapture(bin, argv, {
    timeoutMs: config.timeoutMs,
    maxOutputChars: config.maxOutputChars,
    env: cleanEnv(),
  });
  return {
    ...result,
    ok: result.exitCode === 0 && !result.timedOut && result.error === null,
  };
}
