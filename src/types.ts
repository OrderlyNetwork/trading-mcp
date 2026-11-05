export interface SchemaArg {
  name: string;
  long: string | null;
  short: string | null;
  valueName: string | null;
  required: boolean;
  takesValue: boolean;
  possibleValues: string[];
  defaultValue: string | null;
  numArgs?: { min: number; max: number } | null;
  help: string | null;
}

export interface SchemaCommand {
  path: string;
  about: string | null;
  longAbout?: string | null;
  mutates: boolean;
  args: SchemaArg[];
  subcommands: SchemaCommand[];
}

export interface CliSchema {
  name: string;
  version: string;
  description: string | null;
  globalArgs: SchemaArg[];
  commands: SchemaCommand[];
}

export type CandidateStatus =
  | 'ok'
  | 'missing'
  | 'not-executable'
  | 'invalid-schema'
  | 'too-old'
  | 'legacy';

export interface CliCandidate {
  path: string;
  status: CandidateStatus;
  version?: string;
  detail: string;
}

export interface CliLocation {
  bin: string;
  version: string;
  schema: CliSchema;
}

export interface DiscoveryResult {
  location: CliLocation | null;
  candidates: CliCandidate[];
  error: string | null;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function textResult(text: string, isError = false): ToolResult {
  return isError
    ? { content: [{ type: 'text', text }], isError: true }
    : { content: [{ type: 'text', text }] };
}
