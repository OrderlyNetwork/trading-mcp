import type { ServerContext } from './context.js';
import { runOrderly } from './cli/run.js';
import { readCliDefaultNetwork, resolveNetwork } from './network.js';
import { APP_VERSION } from './version.js';

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const RESOURCE_DEFINITIONS: ResourceDefinition[] = [
  {
    uri: 'orderly://schema',
    name: 'Orderly CLI schema',
    description:
      'Machine-readable manifest of every installed CLI command, argument and mutates flag.',
    mimeType: 'application/json',
  },
  {
    uri: 'orderly://accounts',
    name: 'Stored Orderly accounts',
    description:
      'Accounts stored in the OS keychain for testnet and mainnet (public account IDs only).',
    mimeType: 'application/json',
  },
  {
    uri: 'orderly://config',
    name: 'Effective MCP configuration',
    description:
      'CLI binary, versions, profile, network, safety gates and limits. Never contains secrets.',
    mimeType: 'application/json',
  },
  {
    uri: 'orderly://guide',
    name: 'Orderly trading guide',
    description:
      'Setup, preview-then-execute flow, perps vs Predict, escape hatch and error codes.',
    mimeType: 'text/markdown',
  },
];

const GUIDE = `# Orderly trading MCP

This server wraps the locally installed \`orderly\` CLI. Private keys live in the
OS keychain; the MCP process never sees them and never signs anything itself.

## Setup (outside the MCP)

1. Install the CLI (v2.1.0 recommended; v2.0.1 works with fallbacks):

   \`\`\`sh
   curl -fsSL https://orderly.network/cli.sh | sh
   \`\`\`

2. Check accounts:

   \`\`\`sh
   orderly auth-list
   \`\`\`

3. If the list is empty, create and register a wallet, then add an API key:

   \`\`\`sh
   orderly wallet-create --type EVM --network testnet
   orderly wallet-register --broker-id demo --network testnet
   orderly wallet-add-key --broker-id demo --scope read,trading --network testnet
   \`\`\`

Key and wallet management is intentionally not exposed as MCP tools.

## Before every trade

1. \`auth_list\` to pick an account ID (omit it when exactly one account exists).
2. \`account_balance\` and \`positions_list\` to see the current state.
3. For any mutating command that supports it, call it with \`dry_run: true\` first,
   show the user the exact request, then repeat with \`dry_run: false\`.

## Perpetual futures vs Orderly Predict

- \`order_place\`, \`order_edit\`, \`order_cancel\`, \`positions_close\` and \`leverage\`
  are perpetual-futures commands.
- Predict round symbols are permanent and per-round. Always read them from
  \`predict_rounds\` (or \`predict-round\`) and never construct or reuse one.
- Buying DOWN at \`d\` is sent to the UP book as SELL at \`1 - d\`. Use
  \`predict_orderbook\` to read \`down_asks\` / \`down_bids\`.
- Predict accepts only LIMIT, IOC and POST_ONLY, with isolated margin.

## Commands without a dedicated tool

Use the two meta-tools:

1. \`orderly_commands({ query })\` returns the exact command name, usage,
   argument names, enums and required flags.
2. \`orderly_run({ command, args })\` executes it with structured arguments.

Examples of commands reached this way: \`algo_order_place\`, \`order_get\`,
\`order_edit\`, \`trades\`, \`funding_rates\`, \`symbols\`, \`fee_tier\`,
\`positions_history\`, \`predict_orderbook\`.

## Testnet faucet

\`faucet_account\` (full profile) credits the Orderly account directly and can
wait for the balance. It can take up to 120 seconds, so raise
\`ORDERLY_MCP_TIMEOUT_MS\` (for example to \`180000\`) before using \`--wait\`.
\`faucet_account\` requires CLI v2.1.0+; on v2.0.1 use \`faucet_usdc\` with the
wallet address instead.

## Exit codes

| Code | Meaning | What to do |
| --- | --- | --- |
| 0 | Success | — |
| 2 | Usage / validation | \`orderly_commands\` for the exact spec |
| 3 | Authentication | Check \`auth_list\`; set up a key with the CLI |
| 4 | Trading rejection | Check balance, leverage, symbol and price |
| 5 | Transient | Retry after a short delay |

## Safety switches

- \`ORDERLY_MCP_READ_ONLY=1\` disables every mutating command.
- \`ORDERLY_MCP_ALLOW_MAINNET=0\` blocks mainnet mutations.
- \`ORDERLY_MCP_PROFILE=core|predict|algo|all|full\` controls the tool surface.
  The escape hatch still reaches every allowed command.
- Key, wallet, auth and broker management commands are never available.
`;

export interface ResourceContents {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}

async function accountsResource(ctx: ServerContext): Promise<string> {
  if (!ctx.discovery.location) {
    return ctx.discovery.error ?? 'No compatible orderly CLI found.';
  }
  const networks = ['testnet', 'mainnet'] as const;
  const entries = await Promise.all(
    networks.map(async (network) => {
      const result = await runOrderly(
        ctx.discovery.location!.bin,
        ['auth-list', '--network', network],
        ctx.config
      );
      if (!result.ok) {
        return [
          network,
          {
            error: result.timedOut
              ? 'timed out'
              : `orderly exited with code ${result.exitCode}`,
            stderr: result.stderr.trim(),
          },
        ] as const;
      }
      try {
        return [network, JSON.parse(result.stdout)] as const;
      } catch {
        return [network, result.stdout.trim()] as const;
      }
    })
  );
  return JSON.stringify(Object.fromEntries(entries), null, 2);
}

export async function readResource(
  uri: string,
  ctx: ServerContext
): Promise<ResourceContents> {
  switch (uri) {
    case 'orderly://schema': {
      const schema = ctx.discovery.location?.schema;
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: schema
              ? JSON.stringify(schema)
              : ctx.discovery.error ?? 'No compatible orderly CLI found.',
          },
        ],
      };
    }
    case 'orderly://accounts':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: await accountsResource(ctx),
          },
        ],
      };
    case 'orderly://config':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                server: { name: 'orderly-trading-mcp', version: APP_VERSION },
                cli: ctx.discovery.location
                  ? {
                      bin: ctx.discovery.location.bin,
                      version: ctx.discovery.location.version,
                      schemaVersion: ctx.discovery.location.schema.version,
                    }
                  : null,
                profile: ctx.config.profile,
                readOnly: ctx.config.readOnly,
                allowMainnet: ctx.config.allowMainnet,
                network: {
                  override: ctx.config.network,
                  cliDefault: readCliDefaultNetwork(),
                  effective: resolveNetwork(ctx.config, undefined),
                },
                timeoutMs: ctx.config.timeoutMs,
                maxOutputChars: ctx.config.maxOutputChars,
                tools: ctx.commands.length,
                error: ctx.discovery.error,
              },
              null,
              2
            ),
          },
        ],
      };
    case 'orderly://guide':
      return {
        contents: [{ uri, mimeType: 'text/markdown', text: GUIDE }],
      };
    default:
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: `Unknown resource: ${uri}`,
          },
        ],
      };
  }
}
