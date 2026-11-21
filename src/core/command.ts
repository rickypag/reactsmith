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
      /** The host refuses to run the command without it. */
      required?: boolean;
    };

export type OptionSpecs = Record<string, OptionSpec>;

/** A positional argument, e.g. the feature name in "feature create user-profile". */
export interface ArgSpec {
  name: string;
  description: string;
  required?: boolean;
  /** Only for the last argument: collects all remaining words, joined with spaces. */
  variadic?: boolean;
}

export type ArgSpecs = readonly ArgSpec[];

/** "dry-run" → "dryRun" */
type CamelCase<S extends string> = S extends `${infer Head}-${infer Tail}` ? `${Head}${Capitalize<CamelCase<Tail>>}` : S;

type OptionValue<O extends OptionSpec> = O extends { type: 'boolean' }
  ? boolean
  : O extends { values: readonly (infer V)[] }
    ? V | (O extends { required: true } ? never : undefined)
    : string | (O extends { required: true } ? never : undefined);

/** Option values as the command receives them, keyed in camelCase: "dry-run" becomes `dryRun`. */
export type OptionValues<S extends OptionSpecs> = { [K in keyof S & string as CamelCase<K>]: OptionValue<S[K]> };

/** Argument values keyed by name: required arguments are always strings. */
export type ArgValues<A extends ArgSpecs> = {
  [K in A[number] as CamelCase<K['name']>]: K extends { required: true } ? string : string | undefined;
};

/** What a host gives a command when it runs it. */
export interface CommandContext<S extends OptionSpecs, A extends ArgSpecs = []> {
  /** Absolute project root. */
  cwd: string;
  args: ArgValues<A>;
  options: OptionValues<S>;
  /** Asks the user a yes/no question. Undefined when the host cannot ask (CI, agents, JSON output). */
  confirm?: (question: string) => Promise<boolean>;
  /** Asks the user for a text answer, returning `defaultValue` when they just press enter. Undefined like `confirm`. */
  ask?: (question: string, defaultValue: string) => Promise<string>;
  /** Reads the whole input stream, for an option given as "-". Undefined when the host has none (e.g. a batch line). */
  readStdin?: () => Promise<string>;
}

/**
 * A command: a name, its arguments and options, and the work. It never prints or reads input itself.
 * It is always run by a host (the CLI today), which collects the input and shows the result.
 */
export interface Command<S extends OptionSpecs = OptionSpecs, A extends ArgSpecs = ArgSpecs> {
  /** One word ("init"), or a group and a subcommand ("feature create"). */
  name: string;
  description: string;
  /** Positional arguments, in order. Required ones must come first. */
  args?: A;
  options: S;
  run(context: CommandContext<S, A>): Promise<CommandResult>;
}

export function defineCommand<const S extends OptionSpecs, const A extends ArgSpecs = []>(
  command: Command<S, A>,
): Command<S, A> {
  return command;
}

/** "dry-run" → "dryRun", the key a command reads its option or argument from. */
export function optionKey(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
