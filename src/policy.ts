import type { ServerConfig } from './config.js';
import type { SchemaCommand } from './types.js';

/**
 * Commands that would move, export, or create secrets. These are never exposed,
 * in any profile, including through orderly_run.
 *
 * auth-export-key is read-only in the CLI manifest (mutates=false) but prints a
 * private key, so it must be denied explicitly.
 */
export const SECRET_COMMANDS: ReadonlySet<string> = new Set([
  'auth-export-key',
  'auth-import',
  'auth-logout',
  'auth-cleanup',
  'wallet-create',
  'wallet-import',
  'wallet-remove',
  'wallet-logout',
  'wallet-register',
  'wallet-add-key',
  'wallet-revoke-key',
  'broker-create',
]);

/** Internal-only command; the MCP exposes the schema as a resource instead. */
const INTERNAL_COMMANDS: ReadonlySet<string> = new Set(['schema']);

/**
 * Mutating commands the MCP is allowed to run. This is an allowlist on purpose:
 * a new mutating CLI command stays invisible until it is reviewed here.
 */
export const TRADING_MUTATIONS: ReadonlySet<string> = new Set([
  'order-place',
  'order-cancel',
  'order-edit',
  'order-cancel-all',
  'order-cancel-by-client-id',
  'batch-order-place',
  'batch-order-cancel',
  'batch-order-cancel-by-client-id',
  'algo-order-place',
  'algo-order-cancel',
  'algo-order-edit',
  'algo-order-cancel-all',
  'algo-order-cancel-by-client-id',
  'positions-close',
  'leverage',
  'settle-pnl',
  'predict-buy',
  'predict-sell',
  'predict-close',
]);

/** Higher-risk fund movements, only in the `full` profile. */
const FULL_ONLY_MUTATIONS: ReadonlySet<string> = new Set([
  'withdraw',
  'faucet-usdc',
  'faucet-account',
]);

/** Profile `core`: the high-frequency trading path (plus the two manual tools). */
export const CORE_COMMANDS: readonly string[] = [
  'auth-list',
  'account-balance',
  'positions-list',
  'order-list',
  'market-price',
  'market-orderbook',
  'kline',
  'order-place',
  'order-cancel',
  'order-cancel-all',
  'positions-close',
  'leverage',
];

const PREDICT_COMMANDS: readonly string[] = [
  'predict-rounds',
  'predict-orderbook',
  'predict-buy',
  'predict-sell',
  'predict-close',
];

const ALGO_COMMANDS: readonly string[] = [
  'algo-order-place',
  'algo-order-cancel',
  'algo-order-list',
];

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

export function isCommandAllowed(
  command: SchemaCommand,
  config: ServerConfig
): PolicyDecision {
  if (SECRET_COMMANDS.has(command.path)) {
    return {
      allowed: false,
      reason: `"${command.path}" manages keys or credentials and is not available through the MCP. Use the orderly CLI directly.`,
    };
  }
  if (INTERNAL_COMMANDS.has(command.path)) {
    return {
      allowed: false,
      reason: 'The schema is exposed as the orderly://schema resource.',
    };
  }
  if (command.mutates) {
    if (config.readOnly) {
      return {
        allowed: false,
        reason: 'The server is running with ORDERLY_MCP_READ_ONLY=1; mutating commands are disabled.',
      };
    }
    const allowed =
      TRADING_MUTATIONS.has(command.path) ||
      (config.profile === 'full' && FULL_ONLY_MUTATIONS.has(command.path));
    if (!allowed) {
      return {
        allowed: false,
        reason: `"${command.path}" is not in the MCP trading allowlist for profile "${config.profile}".`,
      };
    }
  }
  return { allowed: true };
}

export function visibleCommands(
  commands: SchemaCommand[],
  config: ServerConfig
): SchemaCommand[] {
  return commands.filter((command) => isCommandAllowed(command, config).allowed);
}

function profileCommandSet(config: ServerConfig): Set<string> | null {
  if (config.profile === 'all' || config.profile === 'full') return null;
  const selected = new Set<string>(CORE_COMMANDS);
  if (config.profile === 'predict') {
    for (const command of PREDICT_COMMANDS) selected.add(command);
  }
  if (config.profile === 'algo') {
    for (const command of ALGO_COMMANDS) selected.add(command);
  }
  return selected;
}

export function commandsForProfile(
  commands: SchemaCommand[],
  config: ServerConfig
): SchemaCommand[] {
  const allowed = visibleCommands(commands, config);
  const selected = profileCommandSet(config);
  if (selected === null) return allowed;
  return allowed.filter((command) => selected.has(command.path));
}
