import type { Tool, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { enumValuesFor, requiredParams } from '../args.js';
import type { ServerConfig } from '../config.js';
import {
  argParamName,
  commandUsage,
  isBooleanArg,
  isEnumArg,
  isVariadicArg,
} from '../cli/schema.js';
import { commandsForProfile } from '../policy.js';
import type { SchemaArg, SchemaCommand } from '../types.js';
import { TOOL_METADATA } from './metadata.js';

export interface GeneratedTool {
  tool: Tool;
  command: SchemaCommand;
}

function supportsDryRun(cmd: SchemaCommand): boolean {
  return cmd.args.some((arg) => arg.long === 'dry-run');
}

function firstLine(value: string | null | undefined): string {
  return value?.split('\n')[0]?.trim() ?? '';
}

function toolName(cmd: SchemaCommand): string {
  return cmd.path.replace(/-/g, '_');
}

function propertyFor(
  cmd: SchemaCommand,
  arg: SchemaArg
): Record<string, unknown> {
  const param = argParamName(arg);
  const description = arg.help?.trim() || `${arg.valueName ?? arg.name}`;

  if (isBooleanArg(arg)) {
    return { type: 'boolean', description };
  }

  if (isEnumArg(arg)) {
    const values = enumValuesFor(cmd.path, arg);
    return {
      type: 'string',
      enum: values,
      description: `${description} One of: ${values.join(', ')}.`,
    };
  }

  if (isVariadicArg(cmd, arg)) {
    return {
      type: 'array',
      items: { type: 'string' },
      description: `${description} Provide one or more values.`,
    };
  }

  if (param === 'orders') {
    return {
      anyOf: [
        { type: 'string' },
        { type: 'array', items: { type: 'object' } },
        { type: 'object' },
      ],
      description:
        'JSON array of orders, a JSON string, or a path to a JSON file.',
    };
  }

  return {
    anyOf: [{ type: 'string' }, { type: 'number' }],
    description,
  };
}

function inputSchemaFor(cmd: SchemaCommand): Tool['inputSchema'] {
  const properties: Record<string, object> = {};
  for (const arg of cmd.args) {
    properties[argParamName(arg)] = propertyFor(cmd, arg);
  }
  properties.network = {
    type: 'string',
    enum: ['mainnet', 'testnet'],
    description:
      'Network override for this call. Defaults to ORDERLY_MCP_NETWORK, then the CLI config.',
  };

  const required = requiredParams(cmd);
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function generatedDescription(cmd: SchemaCommand): string {
  const about = firstLine(cmd.about) || cmd.path;
  const longAbout = cmd.longAbout?.trim();
  const lead = cmd.mutates
    ? 'Mutating command.'
    : 'Read-only command.';
  const body = longAbout && longAbout !== about ? `\n\n${longAbout}` : '';
  return `${lead} ${about}${body}\n\nUsage: ${commandUsage(
    cmd
  )}. Call orderly_commands for the complete argument spec.`;
}

function descriptionFor(cmd: SchemaCommand): string {
  const metadata = TOOL_METADATA[cmd.path];
  let description = metadata?.description ?? generatedDescription(cmd);
  if (
    cmd.mutates &&
    supportsDryRun(cmd) &&
    !description.includes('dry_run')
  ) {
    description += ' Set dry_run=true to preview the exact request before executing.';
  }
  return description;
}

function annotationsFor(cmd: SchemaCommand, title: string): ToolAnnotations {
  return cmd.mutates
    ? {
        title,
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      }
    : {
        title,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      };
}

export function buildTools(
  commands: SchemaCommand[],
  config: ServerConfig
): GeneratedTool[] {
  return commandsForProfile(commands, config).map((command) => {
    const metadata = TOOL_METADATA[command.path];
    const title =
      metadata?.title || firstLine(command.about) || command.path;
    return {
      command,
      tool: {
        name: toolName(command),
        title,
        description: descriptionFor(command),
        inputSchema: inputSchemaFor(command),
        annotations: annotationsFor(command, title),
      },
    };
  });
}
