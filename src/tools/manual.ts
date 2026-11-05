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
import { isCommandAllowed, visibleCommands } from '../policy.js';
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
          'Command name (order-place), keyword (algo, predict, history), or empty to list all available commands.',
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
          'Structured arguments keyed by the names returned by orderly_commands, e.g. {"symbol":"PERP_ETH_USDC","side":"BUY"}.',
        additionalProperties: true,
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

  const limited = available.slice(0, 50);
  const payload = {
    count: available.length,
    ...(available.length > limited.length
      ? { truncated: true, showing: limited.length }
      : {}),
    commands: limited.map((cmd) => commandSummary(cmd, detail === 'full')),
    hint:
      available.length === 0
        ? 'No matching command. Omit query to list every command available through the MCP.'
        : 'Execute with orderly_run({ command, args }). Pass network to override the default. Use a dedicated tool when one exists.',
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

  if (command.mutates && network === 'mainnet' && !deps.config.allowMainnet) {
    return textResult(
      'Mainnet mutations are disabled (ORDERLY_MCP_ALLOW_MAINNET=0). Pass network="testnet" or enable mainnet in the server configuration.',
      true
    );
  }

  const built = buildArgv(command, input, { network });
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
    const normalized = normalizeCommandName(rawCommand);
    const suggestions = commands
      .filter(
        (candidate) =>
          candidate.path.includes(normalized) ||
          normalized.includes(candidate.path)
      )
      .slice(0, 8)
      .map((candidate) => candidate.path);
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

  const args = input.args ?? {};
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return textResult('Argument "args" must be an object.', true);
  }

  return executeCommand(command, args as Record<string, unknown>, deps);
}
