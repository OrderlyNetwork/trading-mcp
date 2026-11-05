import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ServerConfig } from '../config.js';
import { buildDiscoveryReport } from '../doctor.js';
import type { DiscoveryResult, ToolResult } from '../types.js';
import { textResult } from '../types.js';

export const STATUS_TOOL_NAME = 'orderly_status';

export function statusTool(): Tool {
  return {
    name: STATUS_TOOL_NAME,
    title: 'Orderly CLI status',
    description:
      'Report why the Orderly CLI is unavailable and how to fix it. The trading tools are disabled until a compatible orderly CLI (v2.0.1+) is found.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: {
      title: 'Orderly CLI status',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

export function handleStatus(
  discovery: DiscoveryResult,
  config: ServerConfig
): ToolResult {
  return textResult(buildDiscoveryReport(discovery, config), true);
}
