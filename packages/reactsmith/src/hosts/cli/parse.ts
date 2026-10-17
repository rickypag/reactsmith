import { parseArgs } from 'node:util';
import { optionKey, type ArgSpecs, type OptionSpecs } from '../../core/command.js';

export const GLOBAL_OPTIONS = {
  cwd: { type: 'string', placeholder: 'dir', description: 'Project root (default: current directory)' },
  json: { type: 'boolean', description: 'Print machine-readable JSON (never prompts)' },
  help: { type: 'boolean', short: 'h', description: 'Show help for the command' },
} as const satisfies OptionSpecs;

export class UsageError extends Error {}

export interface Parsable {
  name: string;
  args?: ArgSpecs;
  options: OptionSpecs;
}

export interface ParsedArgs {
  cwd?: string;
  json: boolean;
  help: boolean;
  /** Positional arguments keyed by name, in camelCase. */
  args: Record<string, string | undefined>;
  /** Command options keyed in camelCase. */
  options: Record<string, unknown>;
}

function usageMessage(target: Parsable, error: unknown): string {
  const { code, message } = error as { code?: string; message: string };
  const quoted = /'([^']+)'/.exec(message)?.[1];
  if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && quoted) return `Unknown option "${quoted}" for "${target.name}".`;
  return message;
}

function parsePositionals(target: Parsable, positionals: string[], help: boolean): Record<string, string | undefined> {
  const specs = target.args ?? [];
  const last = specs[specs.length - 1];
  const extra = last?.variadic ? [] : positionals.slice(specs.length);
  if (extra.length > 0) {
    throw new UsageError(
      specs.length === 0
        ? `"${target.name}" does not take arguments, got "${extra[0]}".`
        : `Too many arguments for "${target.name}", got "${extra[0]}".`,
    );
  }

  const args: Record<string, string | undefined> = {};
  specs.forEach((spec, index) => {
    const value = spec.variadic ? positionals.slice(index).join(' ') || undefined : positionals[index];
    // With --help the command does not run, so missing arguments are fine.
    if (spec.required && value === undefined && !help) {
      throw new UsageError(`Missing argument <${spec.name}> for "${target.name}".`);
    }
    args[optionKey(spec.name)] = value;
  });
  return args;
}

/** Parses the words after the command name. Throws UsageError for unknown options or wrong arguments. */
export function parseCommandArgs(target: Parsable, argv: string[]): ParsedArgs {
  const specs: OptionSpecs = { ...GLOBAL_OPTIONS, ...target.options };
  const config = Object.fromEntries(
    Object.entries(specs).map(([name, spec]) => [name, spec.short ? { type: spec.type, short: spec.short } : { type: spec.type }]),
  );

  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({ args: argv, options: config, strict: true, allowPositionals: true }));
  } catch (error) {
    throw new UsageError(usageMessage(target, error));
  }

  const help = values.help === true;
  const options: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(target.options)) {
    const value = values[name];
    if (spec.type === 'boolean') {
      options[optionKey(name)] = value === true;
      continue;
    }
    if (spec.required && value === undefined && !help) {
      throw new UsageError(`Missing option --${name} for "${target.name}".`);
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
    help,
    args: parsePositionals(target, positionals, help),
    options,
  };
}
