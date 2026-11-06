export type Profile = 'core' | 'predict' | 'algo' | 'all' | 'full';

export type NetworkName = 'mainnet' | 'testnet';

export interface ServerConfig {
  profile: Profile;
  readOnly: boolean;
  network: NetworkName | null;
  account: string | null;
  allowMainnet: boolean;
  timeoutMs: number;
  maxOutputChars: number;
  debug: boolean;
}

export class ConfigError extends Error {}

const PROFILES: readonly Profile[] = ['core', 'predict', 'algo', 'all', 'full'];

function truthy(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function positiveInt(
  value: string | undefined,
  fallback: number,
  minimum: number,
  name: string
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new ConfigError(`${name} must be an integer >= ${minimum}, got "${value}"`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawProfile = (env.ORDERLY_MCP_PROFILE ?? 'core').trim().toLowerCase();
  if (!PROFILES.includes(rawProfile as Profile)) {
    throw new ConfigError(
      `ORDERLY_MCP_PROFILE must be one of ${PROFILES.join(', ')}, got "${rawProfile}"`
    );
  }

  const rawNetwork = (env.ORDERLY_MCP_NETWORK ?? '').trim().toLowerCase();
  if (rawNetwork && rawNetwork !== 'mainnet' && rawNetwork !== 'testnet') {
    throw new ConfigError(
      `ORDERLY_MCP_NETWORK must be mainnet or testnet, got "${rawNetwork}"`
    );
  }

  const rawAccount = (env.ORDERLY_MCP_ACCOUNT ?? '').trim();

  return {
    profile: rawProfile as Profile,
    readOnly: truthy(env.ORDERLY_MCP_READ_ONLY),
    network: rawNetwork ? (rawNetwork as NetworkName) : null,
    account: rawAccount.length > 0 ? rawAccount : null,
    allowMainnet: truthy(env.ORDERLY_MCP_ALLOW_MAINNET, true),
    timeoutMs: positiveInt(env.ORDERLY_MCP_TIMEOUT_MS, 30_000, 1_000, 'ORDERLY_MCP_TIMEOUT_MS'),
    maxOutputChars: positiveInt(
      env.ORDERLY_MCP_MAX_OUTPUT,
      65_536,
      1_024,
      'ORDERLY_MCP_MAX_OUTPUT'
    ),
    debug: truthy(env.ORDERLY_MCP_DEBUG),
  };
}
