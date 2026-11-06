import type { ServerConfig } from './config.js';
import type { RunResult } from './cli/run.js';
import { textResult, type ToolResult } from './types.js';

function hintForExit(code: number, detail: string): string {
  if (detail.toLowerCase().includes('multiple accounts found')) {
    return 'Multiple accounts found. Pass account=<id> or set ORDERLY_MCP_ACCOUNT. See orderly://accounts for the full list.';
  }
  const apiError = /^(API Error|Error:)/i.test(detail);
  switch (code) {
    case 2:
      return apiError
        ? 'The API rejected the request. Read the message above and check the symbol, price, quantity and account state; use orderly_commands only if an argument name or enum is wrong.'
        : 'Invalid arguments. Call orderly_commands({ command: "<name>" }) for the exact argument spec.';
    case 3:
      return 'Authentication failed. Run `orderly auth-list` or set up an API key with the CLI outside the MCP.';
    case 4:
      return 'The exchange rejected the request. Check balance, leverage, symbol and price before retrying.';
    case 5:
      return 'Transient failure (rate limit, network or 5xx). Wait briefly before retrying.';
    default:
      return 'The CLI reported an error. Read the message above and check the account, symbol and order state.';
  }
}

function batchFailureSummary(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const rows = (parsed as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const allHaveSuccess = rows.every(
    (row) =>
      typeof row === 'object' &&
      row !== null &&
      typeof (row as { success?: unknown }).success === 'boolean'
  );
  if (!allHaveSuccess) return null;
  const failed = rows.filter(
    (row) => (row as { success: boolean }).success === false
  );
  if (failed.length === 0) return null;
  const messages = failed.map((row) => {
    const value = row as { error_message?: unknown; message?: unknown };
    if (typeof value.error_message === 'string') return value.error_message;
    if (typeof value.message === 'string') return value.message;
    return 'unknown error';
  });
  return `Batch completed with ${failed.length} of ${rows.length} item(s) failed: ${messages.join(
    '; '
  )}`;
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
      `${detail}\n\n[exit code ${result.exitCode}] ${hintForExit(
        result.exitCode,
        detail
      )}`,
      true
    );
  }

  if (result.truncated) {
    return textResult(
      `Orderly output exceeded ${config.maxOutputChars} characters and was truncated. Narrow the query (smaller size/page/depth) or raise ORDERLY_MCP_MAX_OUTPUT.`,
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
        `The API returned success=false:\n${JSON.stringify(parsed)}`,
        true
      );
    }
    const batchFailure = batchFailureSummary(parsed);
    if (batchFailure) {
      return textResult(`${batchFailure}\n${JSON.stringify(parsed)}`, true);
    }
    text = JSON.stringify(parsed);
  } catch {
    // Not JSON (for example "No keys stored..."), return the text unchanged.
  }

  const stderr = result.stderr.trim();
  if (stderr.length > 0) {
    text += `\n\n[stderr]\n${stderr}`;
  }
  return textResult(text);
}
