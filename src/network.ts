import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { NetworkName, ServerConfig } from './config.js';

export function readCliDefaultNetwork(
  env: NodeJS.ProcessEnv = process.env
): NetworkName {
  const home = env.HOME ?? homedir();
  try {
    const raw = JSON.parse(
      readFileSync(path.join(home, '.orderly-cli', 'config.json'), 'utf8')
    ) as { defaultNetwork?: string };
    if (raw.defaultNetwork === 'mainnet' || raw.defaultNetwork === 'testnet') {
      return raw.defaultNetwork;
    }
  } catch {
    // Missing or malformed config: the CLI itself defaults to testnet.
  }
  return 'testnet';
}

export function resolveNetwork(
  config: Pick<ServerConfig, 'network'>,
  requested: NetworkName | undefined,
  env: NodeJS.ProcessEnv = process.env
): NetworkName {
  return requested ?? config.network ?? readCliDefaultNetwork(env);
}
