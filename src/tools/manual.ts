import type { Tool, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { buildArgv, enumValuesFor } from '../args.js';
import type { NetworkName, ServerConfig } from '../config.js';
import { resolveNetwork } from '../network.js';
import { runOrderly } from '../cli/run.js';
import {
  argParamName,
  commandUsage,
  findCommand,
  isBooleanArg,
  isEnumArg,
  isVariadicArg,
  normalizeCommandName,
} from '../cli/schema.js';
import { formatRunResult } from '../output.js';
import { serializeMutation } from '../mutex.js';
import { commandsForProfile, isCommandAllowed, visibleCommands } from '../policy.js';
import type { CliLocation, SchemaCommand, ToolResult } from '../types.js';
import { textResult } from '../types.js';

const META_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export interface ToolDeps {
  location: CliLocation;
  config: ServerConfig;
}

function debugLog(config: ServerConfig, message: string): void {
  if (config.debug) process.stderr.write(`[orderly-trading-mcp] ${message}\n`);
}

export const COMMANDS_TOOL: Tool = {
  name: 'orderly_commands',
  title: 'Search the Orderly CLI commands',
  description:
    "Search the installed orderly CLI command surface. Use this before orderly_run whenever a dedicated tool does not cover the task. Returns command names, whether they mutate, usage, argument names/types/enums and help. Pass an exact command name (kebab-case or snake_case) for full detail, or a keyword to search. detail='full' includes long_about and complete argument help.",
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Command name (order-place), keyword (algo, predict, history), or empty to list available commands.',
      },
      mutates: {
        type: 'boolean',
        description: 'Filter to mutating (true) or read-only (false) commands.',
      },
      detail: {
        type: 'string',
        enum: ['summary', 'full'],
        description:
          "summary (default) omits long help; full includes long_about and every argument description.",
      },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Number of matching commands to skip (default 0).',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 200,
        description: 'Maximum commands to return (default 50, max 200).',
      },
    },
    additionalProperties: false,
  },
  annotations: {
    ...META_ANNOTATIONS,
    title: 'Search the Orderly CLI commands',
    readOnlyHint: true,
    destructiveHint: false,
  },
};

export const RUN_TOOL: Tool = {
  name: 'orderly_run',
  title: 'Run an Orderly CLI command',
  description:
    'Run any Orderly CLI command that is not exposed as a dedicated tool, with structured arguments. Call orderly_commands first to get exact argument names, enums and required flags. Examples: algo_order_place, order_edit, order_get, trades, funding_rates, symbols, predict_rounds. Mutating commands execute immediately unless they support dry_run and it is set to true — always preview first. Key, wallet and auth management commands are never available. Pass network to override the default.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'CLI command name, e.g. "order-place" or "order_place". Must appear in orderly_commands.',
      },
      args: {
        type: 'object',
        description:
          'Structured arguments keyed by the names returned by orderly_commands, e.g. {"symbol":"PERP_ETH_USDC","side":"BUY"}. Put network here, or use the top-level network field.',
        additionalProperties: true,
      },
      network: {
        type: 'string',
        enum: ['mainnet', 'testnet'],
        description:
          'Network override for this call. Takes precedence over args.network. Defaults to ORDERLY_MCP_NETWORK, then the CLI config.',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  annotations: {
    ...META_ANNOTATIONS,
    title: 'Run an Orderly CLI command',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
};

export const LEVERAGE_GET_TOOL: Tool = {
  name: 'leverage_get',
  title: 'Read leverage',
  description:
    'Read the current leverage and margin mode for a symbol. Read-only; use leverage_set to change it.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol, e.g. PERP_ETH_USDC.',
      },
      account: {
        type: 'string',
        description: 'Account ID. Defaults to ORDERLY_MCP_ACCOUNT, then the CLI default.',
      },
      network: {
        type: 'string',
        enum: ['mainnet', 'testnet'],
        description: 'Network override for this call.',
      },
    },
    required: ['symbol'],
    additionalProperties: false,
  },
  annotations: {
    ...META_ANNOTATIONS,
    title: 'Read leverage',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
};

interface ArgSummary {
  name: string;
  kind: 'positional' | 'flag';
  required: boolean;
  type: 'flag' | 'enum' | 'value' | 'variadic';
  possibleValues?: string[];
  default?: string;
  help?: string;
}

function summarizeArg(cmd: SchemaCommand, full: boolean): ArgSummary[] {
  return cmd.args.map((arg) => {
    const kind = arg.long === null ? 'positional' : 'flag';
    const type = isBooleanArg(arg)
      ? 'flag'
      : isEnumArg(arg)
        ? 'enum'
        : isVariadicArg(cmd, arg)
          ? 'variadic'
          : 'value';
    const summary: ArgSummary = {
      name: argParamName(arg),
      kind,
      required: arg.required,
      type,
    };
    if (isEnumArg(arg)) summary.possibleValues = [...enumValuesFor(cmd.path, arg)];
    if (arg.defaultValue !== null) summary.default = arg.defaultValue;
    if (full && arg.help) summary.help = arg.help;
    return summary;
  });
}

function commandSummary(cmd: SchemaCommand, full: boolean): Record<string, unknown> {
  return {
    command: cmd.path,
    about: cmd.about ?? '',
    ...(full && cmd.longAbout ? { longAbout: cmd.longAbout } : {}),
    mutates: cmd.mutates,
    dryRun: cmd.args.some((arg) => arg.long === 'dry-run'),
    usage: commandUsage(cmd),
    args: summarizeArg(cmd, full),
  };
}

export function handleCommands(
  input: Record<string, unknown>,
  commands: SchemaCommand[],
  config: ServerConfig
): ToolResult {
  const detail = input.detail === 'full' ? 'full' : 'summary';
  const filterMutates =
    typeof input.mutates === 'boolean' ? input.mutates : null;
  const query =
    typeof input.query === 'string' ? input.query.trim() : '';

  let available = visibleCommands(commands, config);
  if (filterMutates !== null) {
    available = available.filter((cmd) => cmd.mutates === filterMutates);
  }
  available.sort((left, right) => left.path.localeCompare(right.path));

  if (query.length > 0) {
    const normalized = normalizeCommandName(query);
    const exact = findCommand(available, normalized);
    if (exact) {
      return textResult(
        JSON.stringify(
          {
            command: commandSummary(exact, true),
            hint: 'Execute with orderly_run({ command, args }).',
          },
          null,
          2
        )
      );
    }

    const terms = normalized.split(/[\s-]+/).filter(Boolean);
    available = available.filter((cmd) => {
      const haystack = `${cmd.path} ${cmd.about ?? ''} ${cmd.longAbout ?? ''}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }

  const offset =
    typeof input.offset === 'number'
      ? Math.max(0, Math.trunc(input.offset))
      : 0;
  const limit =
    typeof input.limit === 'number'
      ? Math.min(200, Math.max(1, Math.trunc(input.limit)))
      : 50;
  const limited = available.slice(offset, offset + limit);
  const nextOffset =
    offset + limited.length < available.length
      ? offset + limited.length
      : undefined;
  const payload = {
    count: available.length,
    offset,
    showing: limited.length,
    ...(nextOffset !== undefined
      ? { truncated: true, next_offset: nextOffset }
      : {}),
    commands: limited.map((cmd) => commandSummary(cmd, detail === 'full')),
    hint:
      available.length === 0
        ? 'No matching command. Omit query to list every command available through the MCP.'
        : 'Execute with orderly_run({ command, args }). Use offset/limit to page through results, or query to narrow them. Use a dedicated tool when one exists.',
  };
  return textResult(JSON.stringify(payload, null, 2));
}

function normalizeRequestedNetwork(value: unknown): NetworkName | undefined | { error: string } {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    return { error: 'network must be "mainnet" or "testnet".' };
  }
  const normalized = value.toLowerCase();
  if (normalized !== 'mainnet' && normalized !== 'testnet') {
    return { error: `network must be "mainnet" or "testnet", got "${value}".` };
  }
  return normalized;
}

export async function executeCommand(
  command: SchemaCommand,
  input: Record<string, unknown>,
  deps: ToolDeps
): Promise<ToolResult> {
  const requestedNetwork = normalizeRequestedNetwork(input.network);
  if (requestedNetwork && typeof requestedNetwork === 'object') {
    return textResult(requestedNetwork.error, true);
  }
  const network = resolveNetwork(deps.config, requestedNetwork);

  const effective = { ...input };
  if (effective.account === undefined && deps.config.account) {
    const hasAccount = command.args.some(
      (arg) => argParamName(arg) === 'account'
    );
    if (hasAccount) effective.account = deps.config.account;
  }

  if (command.mutates && network === 'mainnet' && !deps.config.allowMainnet) {
    return textResult(
      'Mainnet mutations are disabled (ORDERLY_MCP_ALLOW_MAINNET=0). Pass network="testnet" or enable mainnet in the server configuration.',
      true
    );
  }

  const built = buildArgv(command, effective, { network });
  if ('error' in built) {
    return textResult(built.error, true);
  }

  debugLog(
    deps.config,
    `run ${deps.location.bin} ${built.argv.map((part) => part.replace(/\s/g, '\\s')).join(' ')}`
  );
  const result = command.mutates
    ? await serializeMutation(() =>
        runOrderly(deps.location.bin, built.argv, deps.config)
      )
    : await runOrderly(deps.location.bin, built.argv, deps.config);
  debugLog(deps.config, `exit=${result.exitCode} duration=${result.durationMs}ms`);
  return formatRunResult(result, deps.config);
}

export async function handleLeverageGet(
  input: Record<string, unknown>,
  commands: SchemaCommand[],
  deps: ToolDeps
): Promise<ToolResult> {
  const symbol = input.symbol;
  if (typeof symbol !== 'string' || symbol.trim().length === 0) {
    return textResult('Missing required argument "symbol".', true);
  }
  if (input.value !== undefined) {
    return textResult(
      'leverage_get only reads leverage. Use leverage_set with value to change it.',
      true
    );
  }
  if (input.account !== undefined && typeof input.account !== 'string') {
    return textResult('Argument "account" must be a string.', true);
  }
  const account =
    typeof input.account === 'string' && input.account.length > 0
      ? input.account
      : deps.config.account ?? undefined;

  const requestedNetwork = normalizeRequestedNetwork(input.network);
  if (requestedNetwork && typeof requestedNetwork === 'object') {
    return textResult(requestedNetwork.error, true);
  }
  const network = resolveNetwork(deps.config, requestedNetwork);

  if (!findCommand(commands, 'leverage')) {
    return textResult('The installed CLI has no leverage command.', true);
  }

  const argv = ['leverage', `--network=${network}`];
  if (account) {
    argv.push(`--account=${account}`);
  }
  argv.push('--', symbol);

  debugLog(deps.config, `run ${deps.location.bin} ${argv.join(' ')}`);
  const result = await runOrderly(deps.location.bin, argv, deps.config);
  return formatRunResult(result, deps.config);
}

function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix: number[] = Array.from({ length: rows * cols }, () => 0);
  const at = (row: number, col: number): number => matrix[row * cols + col] ?? 0;
  for (let row = 0; row < rows; row += 1) matrix[row * cols] = row;
  for (let col = 0; col < cols; col += 1) matrix[col] = col;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row * cols + col] = Math.min(
        at(row - 1, col) + 1,
        at(row, col - 1) + 1,
        at(row - 1, col - 1) + cost
      );
    }
  }
  return at(rows - 1, cols - 1);
}

function suggestCommands(commands: SchemaCommand[], raw: string): string[] {
  const normalized = normalizeCommandName(raw);
  const substring = commands
    .filter(
      (candidate) =>
        candidate.path.includes(normalized) ||
        normalized.includes(candidate.path)
    )
    .map((candidate) => candidate.path);
  if (substring.length > 0) return substring.slice(0, 8);

  const threshold = Math.max(2, Math.floor(normalized.length / 3));
  return commands
    .map((candidate) => ({
      path: candidate.path,
      distance: editDistance(normalized, normalizeCommandName(candidate.path)),
    }))
    .filter((candidate) => candidate.distance <= threshold)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 5)
    .map((candidate) => candidate.path);
}

export async function handleRun(
  input: Record<string, unknown>,
  commands: SchemaCommand[],
  deps: ToolDeps
): Promise<ToolResult> {
  const rawCommand = input.command;
  if (typeof rawCommand !== 'string' || rawCommand.trim().length === 0) {
    return textResult('Missing required argument "command".', true);
  }

  const command = findCommand(commands, rawCommand);
  if (!command) {
    const suggestions = suggestCommands(commands, rawCommand);
    return textResult(
      `Unknown command "${rawCommand}".${
        suggestions.length > 0
          ? ` Did you mean: ${suggestions.join(', ')}?`
          : ''
      } Call orderly_commands to list available commands.`,
      true
    );
  }

  const decision = isCommandAllowed(command, deps.config);
  if (!decision.allowed) {
    return textResult(decision.reason ?? 'Command is not available.', true);
  }

  if (deps.config.strictProfile) {
    const selected = new Set(
      commandsForProfile(commands, deps.config).map((entry) => entry.path)
    );
    if (!selected.has(command.path)) {
      return textResult(
        `"${command.path}" is not part of profile "${deps.config.profile}" (ORDERLY_MCP_STRICT_PROFILE=1). Change the profile or disable strict mode.`,
        true
      );
    }
  }

  const args = input.args ?? {};
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return textResult('Argument "args" must be an object.', true);
  }

  const merged = { ...(args as Record<string, unknown>) };
  if (input.network !== undefined) {
    merged.network = input.network;
  }
  return executeCommand(command, merged, deps);
}
