import type { HelpEntry } from './help.js';

export type Resolution<E extends HelpEntry> =
  /** A command, and the words left for its arguments and options. */
  | { kind: 'entry'; entry: E; rest: string[] }
  /** A group name alone, e.g. "feature": lists its commands. */
  | { kind: 'group'; group: string; members: E[]; rest: string[] }
  | { kind: 'unknown'; name: string };

/** Shortcuts, e.g. `reactsmith -v` runs `reactsmith version`. */
const ALIASES: Record<string, string> = {
  '-h': 'help',
  '--help': 'help',
  '-v': 'version',
  '--version': 'version',
};

/** Finds the command named by the first words: "init", or a group and a subcommand like "feature create". */
export function resolveCommand<E extends HelpEntry>(words: string[], entries: E[]): Resolution<E> {
  const [first = '', second] = words;
  const head = ALIASES[first] ?? first;

  if (second !== undefined && !second.startsWith('-')) {
    const entry = entries.find((candidate) => candidate.name === `${head} ${second}`);
    if (entry) return { kind: 'entry', entry, rest: words.slice(2) };
  }
  const entry = entries.find((candidate) => candidate.name === head);
  if (entry) return { kind: 'entry', entry, rest: words.slice(1) };

  const members = entries.filter((candidate) => candidate.name.startsWith(`${head} `));
  if (members.length === 0) return { kind: 'unknown', name: head };
  if (second !== undefined && !second.startsWith('-')) return { kind: 'unknown', name: `${head} ${second}` };
  return { kind: 'group', group: head, members, rest: words.slice(1) };
}
