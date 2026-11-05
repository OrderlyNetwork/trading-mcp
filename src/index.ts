#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfig, type ServerConfig } from './config.js';
import { flattenCommands } from './cli/schema.js';
import { locateCli } from './cli/locate.js';
import { runDoctor } from './doctor.js';
import { createMcpServer } from './server.js';
import type { ServerContext } from './context.js';
import { buildTools } from './tools/generate.js';
import { APP_VERSION } from './version.js';

// Piping output (e.g. `doctor | head`) closes stdout early.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

function printHelp(): void {
  process.stdout.write(
    [
      `orderly-trading-mcp ${APP_VERSION}`,
      '',
      'Usage: orderly-trading-mcp [command]',
      '',
      'Commands:',
      '  (none)    Start the MCP server over stdio',
      '  doctor    Check CLI discovery, configuration and stored accounts',
      '  schema    Print the installed CLI schema as JSON',
      '  tools     Print the tools this configuration registers',
      '  --version Print the version',
      '  --help    Print this help',
      '',
    ].join('\n')
  );
}

async function printTools(config: ServerConfig): Promise<number> {
  const discovery = await locateCli();
  if (!discovery.location) {
    process.stderr.write(`${discovery.error ?? 'No orderly CLI found.'}\n`);
    return 1;
  }
  const commands = flattenCommands(discovery.location.schema);
  const tools = buildTools(commands, config);
  const payload = {
    profile: config.profile,
    readOnly: config.readOnly,
    count: tools.length + 2,
    tools: [
      ...tools.map((entry) => ({
        name: entry.tool.name,
        mutates: entry.command.mutates,
        title: entry.tool.title,
      })),
      { name: 'orderly_commands', mutates: false, title: 'Search the Orderly CLI commands' },
      { name: 'orderly_run', mutates: true, title: 'Run an Orderly CLI command' },
    ],
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 0;
}

async function main(): Promise<number> {
  const command = process.argv[2];

  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${APP_VERSION}\n`);
    return 0;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return 0;
  }
  if (command === 'doctor') {
    return runDoctor();
  }

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

  if (command === 'tools') {
    return printTools(config);
  }

  if (command === 'schema') {
    const discovery = await locateCli();
    if (!discovery.location) {
      process.stderr.write(`${discovery.error ?? 'No orderly CLI found.'}\n`);
      return 1;
    }
    process.stdout.write(
      `${JSON.stringify(discovery.location.schema, null, 2)}\n`
    );
    return 0;
  }

  if (command !== undefined && command.length > 0) {
    process.stderr.write(`Unknown command: ${command}\n\n`);
    printHelp();
    return 2;
  }

  const discovery = await locateCli();
  if (!discovery.location) {
    process.stderr.write(
      `${discovery.error ?? 'No compatible orderly CLI found.'}\n\nStarting anyway; only orderly_status will be available.\n`
    );
  }
  const commands = discovery.location
    ? flattenCommands(discovery.location.schema)
    : [];
  const ctx: ServerContext = { discovery, config, commands };
  const server = createMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (config.debug) {
    process.stderr.write(
      `[orderly-trading-mcp] ready: profile=${config.profile} tools=${
        discovery.location ? buildTools(commands, config).length + 2 : 1
      } cli=${discovery.location?.bin ?? 'none'}\n`
    );
  }

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // The transport keeps the process alive while the client is connected.
  return -1;
}

main()
  .then((code) => {
    if (code >= 0) process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(
      `Fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
