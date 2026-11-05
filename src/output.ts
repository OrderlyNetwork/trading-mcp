import type { ServerConfig } from './config.js';
import type { RunResult } from './cli/run.js';
import { textResult, type ToolResult } from './types.js';

function hintForExit(code: number): string {
  switch (code) {
    case 2:
      return 'Invalid arguments. Call orderly_commands({ command: "<name>" }) for the exact argument spec.';
    case 3:
      return 'Authentication failed. Run `orderly auth-list` or set up an API key with the CLI outside the MCP.';
    case 4:
      return 'The exchange rejected the request. Check balance, leverage, symbol and price before retrying.';
    case 5:
      return 'Transient failure (rate limit, network or 5xx). Wait briefly before retrying.';
    default:
      return 'Run `orderly-trading-mcp doctor` to check the CLI installation.';
  }
}

function truncationNote(result: RunResult, config: ServerConfig): string {
  return result.truncated
    ? `\n\n[output truncated at ${config.maxOutputChars} characters; narrow the query with filters or a smaller limit]`
    : '';
}

export function formatRunResult(
  result: RunResult,
  config: ServerConfig
): ToolResult {
  if (result.error) {
    return textResult(
      `Failed to run the orderly CLI: ${result.error}\n\nRun \`orderly-trading-mcp doctor\` to check the installation.`,
      true
    );
  }

  if (result.timedOut) {
    return textResult(
      `orderly did not finish within ${config.timeoutMs}ms and was terminated. Retry with a narrower query, or raise ORDERLY_MCP_TIMEOUT_MS.`,
      true
    );
  }

  if (result.exitCode !== 0) {
    const detail =
      result.stderr.trim() ||
      result.stdout.trim() ||
      `orderly exited with code ${result.exitCode} and no output.`;
    return textResult(
      `${detail}\n\n[exit code ${result.exitCode}] ${hintForExit(result.exitCode)}${truncationNote(
        result,
        config
      )}`,
      true
    );
  }

  const output = result.stdout.trim();
  if (output.length === 0) {
    const fallback = result.stderr.trim();
    return textResult(fallback.length > 0 ? fallback : '(no output)');
  }

  let text = output;
  try {
    const parsed: unknown = JSON.parse(output);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).success === false
    ) {
      return textResult(
        `The API returned success=false:\n${JSON.stringify(parsed)}${truncationNote(
          result,
          config
        )}`,
        true
      );
    }
    text = JSON.stringify(parsed);
  } catch {
    // Not JSON (for example "No keys stored..."), return the text unchanged.
  }

  const stderr = result.stderr.trim();
  if (stderr.length > 0) {
    text += `\n\n[stderr]\n${stderr}`;
  }
  return textResult(text + truncationNote(result, config));
}
