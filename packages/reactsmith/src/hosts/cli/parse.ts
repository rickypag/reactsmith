import { parseArgs } from 'node:util';
import { optionKey, type OptionSpecs } from '../../core/command.js';

export const GLOBAL_OPTIONS = {
  cwd: { type: 'string', placeholder: 'dir', description: 'Project root (default: current directory)' },
  json: { type: 'boolean', description: 'Print machine-readable JSON (never prompts)' },
  help: { type: 'boolean', short: 'h', description: 'Show help for the command' },
} as const satisfies OptionSpecs;

export class UsageError extends Error {}

export interface Parsable {
  name: string;
  options: OptionSpecs;
}

export interface ParsedArgs {
  cwd?: string;
  json: boolean;
  help: boolean;
  options: Record<string, unknown>;
}

function usageMessage(target: Parsable, error: unknown): string {
  const { code, message } = error as { code?: string; message: string };
  const quoted = /'([^']+)'/.exec(message)?.[1];
  if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && quoted) return `Unknown option "${quoted}" for "${target.name}".`;
  if (code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL' && quoted) return `"${target.name}" does not take arguments, got "${quoted}".`;
  return message;
}

export function parseCommandArgs(target: Parsable, argv: string[]): ParsedArgs {
  const specs: OptionSpecs = { ...GLOBAL_OPTIONS, ...target.options };
  const config = Object.fromEntries(
    Object.entries(specs).map(([name, spec]) => [name, spec.short ? { type: spec.type, short: spec.short } : { type: spec.type }]),
  );

  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({ args: argv, options: config, strict: true, allowPositionals: false }));
  } catch (error) {
    throw new UsageError(usageMessage(target, error));
  }

  const options: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(target.options)) {
    const value = values[name];
    if (spec.type === 'boolean') {
      options[optionKey(name)] = value === true;
      continue;
    }
    if (typeof value === 'string' && spec.values && !spec.values.includes(value)) {
      const allowed = spec.values.map((v) => `"${v}"`).join(', ');
      throw new UsageError(`--${name} must be one of ${allowed}, got "${value}".`);
    }
    options[optionKey(name)] = value;
  }

  return {
    cwd: typeof values.cwd === 'string' ? values.cwd : undefined,
    json: values.json === true,
    help: values.help === true,
    options,
  };
}
