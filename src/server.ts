import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ServerContext } from './context.js';
import { buildTools } from './tools/generate.js';
import {
  COMMANDS_TOOL,
  RUN_TOOL,
  executeCommand,
  handleCommands,
  handleRun,
} from './tools/manual.js';
import { STATUS_TOOL_NAME, handleStatus, statusTool } from './tools/status.js';
import { RESOURCE_DEFINITIONS, readResource } from './resources.js';
import { resolveNetwork } from './network.js';
import type { ToolResult } from './types.js';
import { textResult } from './types.js';
import { APP_VERSION } from './version.js';

function asCallToolResult(result: ToolResult): CallToolResult {
  return result as CallToolResult;
}

function buildInstructions(ctx: ServerContext): string {
  const lines = [
    'Orderly Network trading via the locally installed `orderly` CLI. Private keys live in the OS keychain; this server never sees them and never signs.',
    '',
    '- Call auth_list first when the account ID is unknown.',
    '- Before any mutating call, call it with dry_run=true when supported, show the user the exact request, then repeat with dry_run=false.',
    '- For tasks without a dedicated tool, call orderly_commands then orderly_run. Never guess argument names.',
    '- Symbols are uppercase, e.g. PERP_ETH_USDC. Predict round symbols come from predict_rounds; never construct or reuse one.',
    '- Key, wallet and auth management is not available here; ask the user to use the CLI directly.',
    '',
    `Profile: ${ctx.config.profile}. Read-only: ${
      ctx.config.readOnly ? 'yes' : 'no'
    }. Network default: ${resolveNetwork(ctx.config, undefined)}.`,
  ];
  if (!ctx.discovery.location) {
    lines.push('', ctx.discovery.error ?? 'The orderly CLI is unavailable.');
  }
  return lines.join('\n');
}

export function createMcpServer(ctx: ServerContext): Server {
  const generated = ctx.discovery.location
    ? buildTools(ctx.commands, ctx.config)
    : [];
  const toolByName = new Map(
    generated.map((entry) => [entry.tool.name, entry] as const)
  );
  const tools: Tool[] = ctx.discovery.location
    ? [...generated.map((entry) => entry.tool), COMMANDS_TOOL, RUN_TOOL]
    : [statusTool()];

  const server = new Server(
    { name: 'orderly-trading-mcp', version: APP_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: buildInstructions(ctx),
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> => {
      const name = request.params.name;
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;

      try {
        if (name === STATUS_TOOL_NAME) {
          return asCallToolResult(handleStatus(ctx.discovery, ctx.config));
        }
        if (!ctx.discovery.location) {
          return asCallToolResult(
            textResult(
              ctx.discovery.error ?? 'No compatible orderly CLI found.',
              true
            )
          );
        }
        if (name === COMMANDS_TOOL.name) {
          return asCallToolResult(
            handleCommands(args, ctx.commands, ctx.config)
          );
        }
        if (name === RUN_TOOL.name) {
          return asCallToolResult(
            await handleRun(args, ctx.commands, {
              location: ctx.discovery.location,
              config: ctx.config,
            })
          );
        }
        const entry = toolByName.get(name);
        if (!entry) {
          return asCallToolResult(
            textResult(`Unknown tool "${name}".`, true)
          );
        }
        return asCallToolResult(
          await executeCommand(entry.command, args, {
            location: ctx.discovery.location,
            config: ctx.config,
          })
        );
      } catch (error) {
        return asCallToolResult(
          textResult(
            `Internal error in ${name}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            true
          )
        );
      }
    }
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCE_DEFINITIONS,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const contents = await readResource(request.params.uri, ctx);
    return { contents: contents.contents };
  });

  return server;
}
