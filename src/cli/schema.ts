import type { CliSchema, SchemaArg, SchemaCommand } from '../types.js';

export class SchemaError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArg(raw: unknown, where: string): SchemaArg {
  if (!isRecord(raw)) throw new SchemaError(`${where}: argument is not an object`);
  const name = raw.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new SchemaError(`${where}: argument is missing a name`);
  }
  const possibleValues = Array.isArray(raw.possibleValues)
    ? raw.possibleValues.filter((v): v is string => typeof v === 'string')
    : [];
  const numArgs = isRecord(raw.numArgs)
    ? {
        min: typeof raw.numArgs.min === 'number' ? raw.numArgs.min : 1,
        max: typeof raw.numArgs.max === 'number' ? raw.numArgs.max : 1,
      }
    : null;
  return {
    name,
    long: typeof raw.long === 'string' ? raw.long : null,
    short: typeof raw.short === 'string' ? raw.short : null,
    valueName: typeof raw.valueName === 'string' ? raw.valueName : null,
    required: raw.required === true,
    takesValue: raw.takesValue === true,
    possibleValues,
    defaultValue: typeof raw.defaultValue === 'string' ? raw.defaultValue : null,
    numArgs,
    help: typeof raw.help === 'string' ? raw.help : null,
  };
}

function parseCommand(raw: unknown, where: string): SchemaCommand {
  if (!isRecord(raw)) throw new SchemaError(`${where}: command is not an object`);
  if (typeof raw.path !== 'string' || raw.path.length === 0) {
    throw new SchemaError(`${where}: command is missing a path`);
  }
  const args = Array.isArray(raw.args)
    ? raw.args.map((arg, index) => parseArg(arg, `${where}.args[${index}]`))
    : [];
  const subcommands = Array.isArray(raw.subcommands)
    ? raw.subcommands.map((sub, index) =>
        parseCommand(sub, `${where}.subcommands[${index}]`)
      )
    : [];
  return {
    path: raw.path,
    about: typeof raw.about === 'string' ? raw.about : null,
    longAbout: typeof raw.longAbout === 'string' ? raw.longAbout : null,
    mutates: raw.mutates === true,
    args,
    subcommands,
  };
}

export function parseSchema(text: string): CliSchema {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new SchemaError(
      `orderly schema did not return JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!isRecord(raw)) throw new SchemaError('orderly schema returned a non-object');
  if (raw.name !== 'orderly') {
    throw new SchemaError(`unexpected schema name: ${String(raw.name)}`);
  }
  if (typeof raw.version !== 'string') {
    throw new SchemaError('schema is missing a version');
  }
  if (!Array.isArray(raw.commands)) {
    throw new SchemaError('schema is missing a commands array');
  }
  return {
    name: raw.name,
    version: raw.version,
    description: typeof raw.description === 'string' ? raw.description : null,
    globalArgs: Array.isArray(raw.globalArgs)
      ? raw.globalArgs.map((arg, index) => parseArg(arg, `globalArgs[${index}]`))
      : [],
    commands: raw.commands.map((cmd, index) =>
      parseCommand(cmd, `commands[${index}]`)
    ),
  };
}

export function flattenCommands(schema: CliSchema): SchemaCommand[] {
  const commands: SchemaCommand[] = [];
  const visit = (cmd: SchemaCommand): void => {
    if (cmd.subcommands.length === 0) {
      commands.push(cmd);
      return;
    }
    for (const sub of cmd.subcommands) visit(sub);
  };
  for (const cmd of schema.commands) visit(cmd);
  return commands;
}

export function normalizeCommandName(name: string): string {
  return name
    .trim()
    .replace(/^orderly[_-]?/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

export function findCommand(
  commands: SchemaCommand[],
  name: string
): SchemaCommand | undefined {
  const normalized = normalizeCommandName(name);
  return commands.find((cmd) => cmd.path === normalized);
}

export function argParamName(arg: SchemaArg): string {
  const base = arg.long ?? arg.valueName ?? arg.name;
  return base.replace(/-/g, '_');
}

export function isBooleanArg(arg: SchemaArg): boolean {
  return !arg.takesValue;
}

export function isVariadic(arg: SchemaArg): boolean {
  return (arg.numArgs?.max ?? 1) > 1;
}

/**
 * Variadic detection with a fallback for CLI releases before `numArgs` existed
 * in the schema (v2.0.1 and earlier). These are the only variadic positionals
 * in the command surface.
 */
export function isVariadicArg(cmd: SchemaCommand, arg: SchemaArg): boolean {
  if (isVariadic(arg)) return true;
  const param = argParamName(arg);
  return (
    (cmd.path === 'batch-order-cancel' && param === 'order_ids') ||
    (cmd.path === 'batch-order-cancel-by-client-id' &&
      param === 'client_order_ids')
  );
}

export function isEnumArg(arg: SchemaArg): boolean {
  return (
    arg.takesValue &&
    arg.possibleValues.length > 0 &&
    arg.possibleValues.some((value) => value !== 'true' && value !== 'false')
  );
}

export function positionalArgs(cmd: SchemaCommand): SchemaArg[] {
  return cmd.args.filter((arg) => arg.long === null && arg.takesValue);
}

export function flagArgs(cmd: SchemaCommand): SchemaArg[] {
  return cmd.args.filter((arg) => arg.long !== null && arg.takesValue);
}

export function booleanArgs(cmd: SchemaCommand): SchemaArg[] {
  return cmd.args.filter((arg) => !arg.takesValue);
}

export function commandUsage(cmd: SchemaCommand): string {
  const parts = [`orderly ${cmd.path}`];
  for (const arg of positionalArgs(cmd)) {
    const name = arg.valueName ?? arg.name;
    parts.push(arg.required ? `<${name}>` : `[${name}]`);
  }
  if (cmd.args.some((arg) => arg.long !== null)) parts.push('[options]');
  return parts.join(' ');
}
