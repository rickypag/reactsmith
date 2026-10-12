import type { CommandResult } from './result.js';

export type OptionSpec =
  | { type: 'boolean'; short?: string; description: string }
  | {
      type: 'string';
      short?: string;
      description: string;
      /** Name shown in help, e.g. "dir" for "--cwd <dir>". */
      placeholder?: string;
      /** Allowed values, checked by the host before the command runs. */
      values?: readonly string[];
    };

export type OptionSpecs = Record<string, OptionSpec>;

/** "dry-run" → "dryRun" */
type CamelCase<S extends string> = S extends `${infer Head}-${infer Tail}` ? `${Head}${Capitalize<CamelCase<Tail>>}` : S;

type OptionValue<O extends OptionSpec> = O extends { type: 'boolean' }
  ? boolean
  : O extends { values: readonly (infer V)[] }
    ? V | undefined
    : string | undefined;

/** Option values as the command receives them, keyed in camelCase: "dry-run" becomes `dryRun`. */
export type OptionValues<S extends OptionSpecs> = { [K in keyof S & string as CamelCase<K>]: OptionValue<S[K]> };

/** What a host gives a command when it runs it. */
export interface CommandContext<S extends OptionSpecs> {
  /** Absolute project root. */
  cwd: string;
  options: OptionValues<S>;
  /** Asks the user a yes/no question. Undefined when the host cannot ask (CI, agents, JSON output). */
  confirm?: (question: string) => Promise<boolean>;
}

/**
 * A command: a name, its options, and the work. It never prints or reads input itself.
 * It is always run by a host (the CLI today), which collects the options and shows the result.
 */
export interface Command<S extends OptionSpecs = OptionSpecs> {
  name: string;
  description: string;
  options: S;
  run(context: CommandContext<S>): Promise<CommandResult>;
}

export function defineCommand<const S extends OptionSpecs>(command: Command<S>): Command<S> {
  return command;
}

/** "dry-run" → "dryRun", the key a command reads its option from. */
export function optionKey(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
