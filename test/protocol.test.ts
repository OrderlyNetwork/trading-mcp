import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DIST_INDEX, FAKE_BIN, stringEnv } from './helpers.js';

interface TextContent {
  type: string;
  text?: string;
}

function textOf(result: unknown): string {
  if (typeof result !== 'object' || result === null) return '';
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  const first = content[0] as TextContent | undefined;
  return first?.type === 'text' ? (first.text ?? '') : '';
}

async function withClient<T>(
  env: Record<string, string | undefined>,
  run: (client: Client) => Promise<T>
): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DIST_INDEX],
    env: stringEnv({ ORDERLY_BIN: FAKE_BIN, ...env }),
  });
  const client = new Client({ name: 'protocol-test', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

describe('MCP protocol', () => {
  it('registers the 14-tool core surface', async () => {
    await withClient({}, async (client) => {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toHaveLength(14);
      expect(names).toContain('order_place');
      expect(names).toContain('orderly_commands');
      expect(names).toContain('orderly_run');
      expect(names).not.toContain('wallet_import');
      expect(names).not.toContain('auth_export_key');
      expect(names).not.toContain('withdraw');
      expect(names).not.toContain('order_edit');
    });
  });

  it('executes a dry-run order through the fake CLI', async () => {
    await withClient({}, async (client) => {
      const result = await client.callTool({
        name: 'order_place',
        arguments: {
          symbol: 'PERP_ETH_USDC',
          side: 'BUY',
          type: 'LIMIT',
          quantity: 0.01,
          price: 3500,
          dry_run: true,
        },
      });
      const payload = JSON.parse(textOf(result)) as {
        argv: string[];
        dryRun: boolean;
      };
      expect(payload.dryRun).toBe(true);
      expect(payload.argv[0]).toBe('order-place');
      expect(payload.argv).toContain('--dry-run');
      expect(payload.argv).toContain('--network=testnet');
      expect(payload.argv.slice(-4)).toEqual([
        'PERP_ETH_USDC',
        'BUY',
        'LIMIT',
        '0.01',
      ]);
    });
  });

  it('returns actionable validation errors without spawning', async () => {
    await withClient({}, async (client) => {
      const result = await client.callTool({
        name: 'order_place',
        arguments: { symbol: 'PERP_ETH_USDC', side: 'BUY' },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Missing required argument "quantity"');
    });
  });

  it('reaches non-core commands through orderly_run', async () => {
    await withClient({}, async (client) => {
      const result = await client.callTool({
        name: 'orderly_run',
        arguments: {
          command: 'order_edit',
          args: { order_id: '123', price: 3500, dry_run: true },
        },
      });
      const payload = JSON.parse(textOf(result)) as { argv: string[] };
      expect(payload.argv[0]).toBe('order-edit');
      expect(payload.argv.slice(-2)).toEqual(['--', '123']);
    });
  });

  it('honours the top-level network override on orderly_run', async () => {
    await withClient(
      { ORDERLY_MCP_NETWORK: 'mainnet' },
      async (client) => {
        const result = await client.callTool({
          name: 'orderly_run',
          arguments: {
            command: 'auth-list',
            args: {},
            network: 'testnet',
          },
        });
        const payload = JSON.parse(textOf(result)) as { argv: string[] };
        expect(payload.argv).toContain('--network=testnet');
        expect(payload.argv).not.toContain('--network=mainnet');
      }
    );
  });

  it('honours args.network on orderly_run', async () => {
    await withClient(
      { ORDERLY_MCP_NETWORK: 'mainnet' },
      async (client) => {
        const result = await client.callTool({
          name: 'orderly_run',
          arguments: {
            command: 'auth-list',
            args: { network: 'testnet' },
          },
        });
        const payload = JSON.parse(textOf(result)) as { argv: string[] };
        expect(payload.argv).toContain('--network=testnet');
      }
    );
  });

  it('blocks secret commands through the escape hatch', async () => {
    await withClient({}, async (client) => {
      const result = await client.callTool({
        name: 'orderly_run',
        arguments: { command: 'wallet-import' },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('manages keys or credentials');
    });
  });

  it('searches the CLI schema for the exact argument spec', async () => {
    await withClient({}, async (client) => {
      const result = await client.callTool({
        name: 'orderly_commands',
        arguments: { query: 'order-place' },
      });
      const payload = JSON.parse(textOf(result)) as {
        command: {
          command: string;
          args: Array<{ name: string; possibleValues?: string[] }>;
        };
      };
      expect(payload.command.command).toBe('order-place');
      expect(payload.command.args.map((arg) => arg.name)).toContain('symbol');
      expect(payload.command.args.map((arg) => arg.name)).toContain('dry_run');
      const side = payload.command.args.find((arg) => arg.name === 'side');
      expect(side?.possibleValues).toContain('BID');
    });
  });

  it('exposes configuration as a resource without secrets', async () => {
    await withClient({}, async (client) => {
      const result = await client.readResource({ uri: 'orderly://config' });
      const first = result.contents[0] as { text?: string };
      const payload = JSON.parse(first.text ?? '{}') as {
        profile: string;
        cli: { bin: string };
      };
      expect(payload.profile).toBe('core');
      expect(payload.cli.bin).toBe(FAKE_BIN);
    });
  });

  it('removes mutating tools in read-only mode and blocks the escape hatch', async () => {
    await withClient({ ORDERLY_MCP_READ_ONLY: '1' }, async (client) => {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain('market_price');
      expect(names).not.toContain('order_place');

      const result = await client.callTool({
        name: 'orderly_run',
        arguments: {
          command: 'order-place',
          args: { symbol: 'PERP_ETH_USDC', side: 'BUY', quantity: 1 },
        },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('READ_ONLY');
    });
  });

  it('enforces the mainnet mutation gate', async () => {
    await withClient({ ORDERLY_MCP_ALLOW_MAINNET: '0' }, async (client) => {
      const result = await client.callTool({
        name: 'order_place',
        arguments: {
          symbol: 'PERP_ETH_USDC',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.01,
          network: 'mainnet',
          dry_run: true,
        },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Mainnet mutations are disabled');
    });
  });

  it('degrades to orderly_status when the CLI is missing', async () => {
    await withClient(
      { ORDERLY_BIN: '/definitely/missing/orderly' },
      async (client) => {
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name)).toEqual(['orderly_status']);
        const result = await client.callTool({
          name: 'orderly_status',
          arguments: {},
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('No compatible "orderly" CLI found');
      }
    );
  });
});
