import type { ServerConfig } from './config.js';
import { ConfigError, loadConfig } from './config.js';
import { formatCandidate, locateCli } from './cli/locate.js';
import { runOrderly } from './cli/run.js';
import { readCliDefaultNetwork, resolveNetwork } from './network.js';
import type { DiscoveryResult } from './types.js';
import { APP_VERSION } from './version.js';

export function buildDiscoveryReport(
  discovery: DiscoveryResult,
  config: ServerConfig
): string {
  const lines: string[] = [];
  lines.push(`orderly-trading-mcp ${APP_VERSION}`);
  lines.push('');
  lines.push('CLI discovery:');
  if (discovery.candidates.length === 0) {
    lines.push('  (no candidates found)');
  } else {
    for (const candidate of discovery.candidates) {
      lines.push(`  ${formatCandidate(candidate)}`);
    }
  }
  lines.push('');

  if (discovery.location) {
    lines.push(
      `Selected CLI:   ${discovery.location.bin} (v${discovery.location.version})`
    );
    lines.push(`Schema version: ${discovery.location.schema.version}`);
    lines.push(`CLI commands:   ${discovery.location.schema.commands.length}`);
  } else {
    lines.push('Selected CLI:   none');
    if (discovery.error) {
      lines.push('');
      lines.push(discovery.error);
    }
  }

  const cliDefault = readCliDefaultNetwork();
  lines.push(`Profile:        ${config.profile}`);
  lines.push(`Read-only:      ${config.readOnly ? 'yes' : 'no'}`);
  lines.push(
    `Mainnet muts:   ${config.allowMainnet ? 'allowed' : 'blocked'}`
  );
  lines.push(
    `Network:        ${resolveNetwork(config, undefined)} (CLI default: ${cliDefault}${
      config.network ? `, MCP override: ${config.network}` : ''
    })`
  );
  lines.push(`Timeout:        ${config.timeoutMs}ms`);
  lines.push(`Output cap:     ${config.maxOutputChars} chars`);
  return lines.join('\n');
}

async function accountSummary(
  bin: string,
  network: string,
  config: ServerConfig
): Promise<string> {
  const result = await runOrderly(
    bin,
    ['auth-list', '--network', network],
    config
  );
  if (!result.ok) {
    return result.error
      ? `unavailable (${result.error})`
      : `error (exit ${result.exitCode})`;
  }
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (Array.isArray(parsed)) return `${parsed.length} account(s)`;
    return 'unexpected JSON shape';
  } catch {
    if (result.stdout.includes('No keys stored')) return '0 accounts';
    return 'non-JSON output';
  }
}

export async function runDoctor(): Promise<number> {
  let config: ServerConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`Configuration error: ${error.message}\n`);
      return 2;
    }
    throw error;
  }

  const discovery = await locateCli();
  process.stdout.write(`${buildDiscoveryReport(discovery, config)}\n`);

  if (!discovery.location) return 1;

  process.stdout.write('\nAccounts:\n');
  for (const network of ['testnet', 'mainnet']) {
    const summary = await accountSummary(
      discovery.location.bin,
      network,
      config
    );
    process.stdout.write(`  ${network}: ${summary}\n`);
  }

  process.stdout.write('\nMCP client config:\n');
  process.stdout.write(
    `${JSON.stringify(
      {
        mcpServers: {
          'orderly-trading': {
            command: 'npx',
            args: ['-y', '@orderly.network/trading-mcp'],
            env: { ORDERLY_BIN: discovery.location.bin },
          },
        },
      },
      null,
      2
    )}\n`
  );

  return 0;
}
