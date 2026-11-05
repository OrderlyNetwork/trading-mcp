import type { NetworkName } from './config.js';
import type { SchemaArg, SchemaCommand } from './types.js';
import {
  argParamName,
  isBooleanArg,
  isEnumArg,
  isVariadic,
  positionalArgs,
} from './cli/schema.js';

export interface BuildArgvOptions {
  network: NetworkName;
}

export type BuildArgvResult =
  | { argv: string[] }
  | { error: string };

/**
 * The CLI validates a few conditional requirements itself; these are the only
 * required-argument overrides the manifest cannot express.
 */
const REQUIRED_OVERRIDES: Record<string, readonly string[]> = {
  'order-place': ['symbol', 'side', 'quantity'],
};

/** Required argument parameter names, including CLI quirks the manifest misses. */
export function requiredParams(cmd: SchemaCommand): string[] {
  const required = new Set(
    cmd.args.filter((arg) => arg.required).map((arg) => argParamName(arg))
  );
  for (const extra of REQUIRED_OVERRIDES[cmd.path] ?? []) required.add(extra);
  return [...required];
}

interface Binding {
  arg: SchemaArg;
  param: string;
}

function bindingsFor(cmd: SchemaCommand): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  for (const arg of cmd.args) {
    const param = argParamName(arg);
    const binding: Binding = { arg, param };
    const aliases = new Set<string>([
      param,
      arg.name.replace(/-/g, '_'),
      arg.valueName?.replace(/-/g, '_') ?? param,
    ]);
    for (const alias of aliases) {
      if (!bindings.has(alias)) bindings.set(alias, binding);
    }
  }
  return bindings;
}

function isBooleanLike(value: unknown): boolean {
  return (
    typeof value === 'boolean' ||
    value === 1 ||
    value === 0 ||
    (typeof value === 'string' &&
      ['true', 'false', '1', '0'].includes(value.toLowerCase()))
  );
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/** Enum values the CLI accepts but the manifest does not list (short forms). */
const ENUM_EXTENSIONS: Record<string, Record<string, readonly string[]>> = {
  'order-place': { side: ['BUY', 'SELL', 'BID', 'ASK'] },
};

export function enumValuesFor(
  cmdPath: string,
  arg: SchemaArg
): readonly string[] {
  return ENUM_EXTENSIONS[cmdPath]?.[argParamName(arg)] ?? arg.possibleValues;
}

function coerceScalar(
  value: unknown,
  binding: Binding,
  cmdPath: string
): string | { error: string } {
  const { arg } = binding;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { error: `Argument "${binding.param}" must be a finite number.` };
    }
    return String(value);
  }
  if (typeof value === 'string') {
    if (isEnumArg(arg)) {
      const allowed = enumValuesFor(cmdPath, arg);
      const allUppercase = allowed.every(
        (candidate) => candidate === candidate.toUpperCase()
      );
      const candidate = allUppercase ? value.toUpperCase() : value;
      if (!allowed.includes(candidate)) {
        return {
          error: `Argument "${binding.param}" must be one of: ${allowed.join(
            ', '
          )} (got "${value}").`,
        };
      }
      return candidate;
    }
    return value;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return {
    error: `Argument "${binding.param}" must be a string or number.`,
  };
}

function usageLine(cmd: SchemaCommand): string {
  const parts = [`orderly ${cmd.path}`];
  for (const arg of positionalArgs(cmd)) {
    const name = arg.valueName ?? arg.name;
    parts.push(arg.required ? `<${name}>` : `[${name}]`);
  }
  parts.push('[options]');
  return parts.join(' ');
}

function availableParams(cmd: SchemaCommand, bindings: Map<string, Binding>): string {
  const params = new Set<string>();
  for (const binding of bindings.values()) params.add(binding.param);
  params.add('network');
  return [...params].sort().join(', ');
}

/**
 * Convert an MCP tool input into the CLI argv. Pure and fully testable: no
 * process is spawned here.
 */
export function buildArgv(
  cmd: SchemaCommand,
  input: Record<string, unknown>,
  options: BuildArgvOptions
): BuildArgvResult {
  const bindings = bindingsFor(cmd);
  const provided = new Map<string, unknown>();

  for (const [rawKey, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const key = rawKey
      .trim()
      .replace(/-/g, '_')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase();
    if (key === 'network' || key === 'dry_run') {
      provided.set(key, value);
      continue;
    }
    const binding = bindings.get(key);
    if (!binding) {
      return {
        error: `Unknown argument "${rawKey}" for "orderly ${cmd.path}". Available arguments: ${availableParams(
          cmd,
          bindings
        )}.`,
      };
    }
    if (provided.has(binding.param)) {
      return {
        error: `Argument "${binding.param}" was provided more than once.`,
      };
    }
    provided.set(binding.param, value);
  }

  const required = new Set(requiredParams(cmd));

  for (const name of required) {
    const value = provided.get(name);
    if (value === undefined || value === null || value === '') {
      return {
        error: `Missing required argument "${name}" for "orderly ${cmd.path}".\nUsage: ${usageLine(
          cmd
        )}\nAvailable arguments: ${availableParams(cmd, bindings)}.`,
      };
    }
  }

  const flags: string[] = [`--network=${options.network}`];
  const positionals: string[] = [];
  const seen = new Set<string>();

  const emitValue = (binding: Binding, value: unknown): string | null => {
    const { arg, param } = binding;
    if (seen.has(param)) {
      return `Argument "${param}" was provided more than once.`;
    }
    seen.add(param);

    if (isBooleanArg(arg)) {
      if (!isBooleanLike(value)) {
        return `Argument "${param}" is a flag and accepts true or false (got ${JSON.stringify(
          value
        )}).`;
      }
      const enabled = coerceBoolean(value);
      if (enabled === null) {
        return `Argument "${param}" is a flag and accepts true or false.`;
      }
      if (enabled && arg.long) flags.push(`--${arg.long}`);
      return null;
    }

    if (Array.isArray(value)) {
      if (param === 'orders') {
        const text = JSON.stringify(value);
        if (arg.long !== null) flags.push(`--${arg.long}=${text}`);
        else positionals.push(text);
        return null;
      }
      const values = value.map((item) => {
        if (item === null || item === undefined) {
          return { error: `Argument "${param}" contains an empty value.` };
        }
        return coerceScalar(item, binding, cmd.path);
      });
      const failure = values.find(
        (item): item is { error: string } => typeof item === 'object' && 'error' in item
      );
      if (failure) return failure.error;
      const strings = values.map((item) => item as string);
      if (isVariadic(arg)) {
        if (arg.long !== null) {
          flags.push(`--${arg.long}=${strings.join(',')}`);
        } else {
          positionals.push(...strings);
        }
        return null;
      }
      if (param === 'order_ids' || param === 'client_order_ids') {
        if (arg.long !== null) flags.push(`--${arg.long}=${JSON.stringify(strings)}`);
        else positionals.push(JSON.stringify(strings));
        return null;
      }
      return `Argument "${param}" accepts a single value, not an array.`;
    }

    if (typeof value === 'object') {
      if (param === 'orders') {
        const text = JSON.stringify(value);
        if (arg.long !== null) flags.push(`--${arg.long}=${text}`);
        else positionals.push(text);
        return null;
      }
      return `Argument "${param}" does not accept an object.`;
    }

    const scalar = coerceScalar(value, binding, cmd.path);
    if (typeof scalar === 'object') return scalar.error;
    if (arg.long !== null) flags.push(`--${arg.long}=${scalar}`);
    else positionals.push(scalar);
    return null;
  };

  for (const arg of cmd.args) {
    const param = argParamName(arg);
    if (!provided.has(param)) continue;
    const error = emitValue({ arg, param }, provided.get(param));
    if (error) return { error };
  }

  // dry_run is not a manifest argument on every command; only accept it where
  // the CLI actually implements it.
  if (provided.has('dry_run')) {
    const dryRunBinding = [...bindings.values()].find(
      (binding) => binding.param === 'dry_run'
    );
    if (!dryRunBinding) {
      return {
        error: `"orderly ${cmd.path}" does not support dry_run. Call orderly_commands({ command: "${cmd.path}" }) to see its arguments.`,
      };
    }
  }

  const network = provided.get('network');
  if (network !== undefined) {
    if (network !== 'mainnet' && network !== 'testnet') {
      return { error: `Argument "network" must be mainnet or testnet.` };
    }
    const index = flags.findIndex((flag) => flag.startsWith('--network='));
    if (index >= 0) flags[index] = `--network=${network}`;
  }

  const argv = [cmd.path, ...flags];
  if (positionals.length > 0) argv.push('--', ...positionals);
  return { argv };
}
