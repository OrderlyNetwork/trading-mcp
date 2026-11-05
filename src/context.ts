import type { ServerConfig } from './config.js';
import type { DiscoveryResult, SchemaCommand } from './types.js';

export interface ServerContext {
  discovery: DiscoveryResult;
  config: ServerConfig;
  commands: SchemaCommand[];
}
