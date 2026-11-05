import { spawn } from 'node:child_process';

export interface CaptureOptions {
  timeoutMs: number;
  maxOutputChars: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface CaptureResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  truncated: boolean;
  error: string | null;
  durationMs: number;
}

/**
 * Run a binary without a shell, with a hard timeout and bounded output.
 * stdin is closed so the CLI's interactive prompts fail fast instead of hanging.
 */
export function spawnCapture(
  bin: string,
  args: string[],
  options: CaptureOptions
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let errorMessage: string | null = null;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (exitCode: number, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
        truncated,
        error: errorMessage,
        durationMs: Date.now() - started,
      });
    };

    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
      cwd: options.cwd,
      windowsHide: true,
    });

    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 2_000);
    }, options.timeoutMs);

    const consume = (chunk: string, stream: 'stdout' | 'stderr'): void => {
      const current = stream === 'stdout' ? stdout : stderr;
      const remaining = options.maxOutputChars - current.length;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const text = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      if (text.length < chunk.length) truncated = true;
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => consume(chunk, 'stdout'));
    child.stderr?.on('data', (chunk: string) => consume(chunk, 'stderr'));

    child.on('error', (error) => {
      errorMessage = error.message;
      finish(-1, null);
    });
    child.on('close', (code, signal) => finish(code ?? -1, signal));
  });
}

/** Environment for CLI calls: no ANSI colors, no inherited force-color flags. */
export function cleanEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, NO_COLOR: '1', TERM: 'dumb' };
  delete env.FORCE_COLOR;
  delete env.CLICOLOR;
  delete env.CLICOLOR_FORCE;
  return env;
}
