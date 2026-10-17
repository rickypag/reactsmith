import type { ArgSpecs, OptionSpec, OptionSpecs } from '../../core/command.js';
import { TOOL_NAME } from '../../shared/config/defaults.js';
import { GLOBAL_OPTIONS } from './parse.js';

/** Anything listed in the help: a command or a built-in. */
export interface HelpEntry {
  name: string;
  description: string;
  args?: ArgSpecs;
  options: OptionSpecs;
}

function formatFlag(name: string, spec: OptionSpec): string {
  const short = spec.short ? `-${spec.short}, ` : '    ';
  const value = spec.type === 'string' ? ` <${spec.values?.join('|') ?? spec.placeholder ?? 'value'}>` : '';
  return `${short}--${name}${value}`;
}

/** "feature create <name>", "help [command...]" */
function signature(entry: HelpEntry): string {
  const args = (entry.args ?? []).map((arg) => {
    const name = `${arg.name}${arg.variadic ? '...' : ''}`;
    return arg.required ? `<${name}>` : `[${name}]`;
  });
  return [entry.name, ...args].join(' ');
}

function formatRows(rows: [string, string][]): string {
  const width = Math.max(...rows.map(([left]) => left.length)) + 3;
  return rows.map(([left, right]) => `  ${left.padEnd(width)}${right}`).join('\n');
}

function optionRows(options: OptionSpecs): [string, string][] {
  return Object.entries(options).map(([name, spec]) => [
    formatFlag(name, spec),
    spec.type === 'string' && spec.required ? `${spec.description} (required)` : spec.description,
  ]);
}

function commandRows(entries: HelpEntry[]): string {
  return formatRows(entries.map((entry) => [signature(entry), entry.description]));
}

export function generalHelp(entries: HelpEntry[]): string {
  return [
    `Usage: ${TOOL_NAME} <command> [options]`,
    '',
    'Commands:',
    commandRows(entries),
    '',
    'Global options:',
    formatRows(optionRows(GLOBAL_OPTIONS)),
    '',
    `Run "${TOOL_NAME} help <command>" for the arguments and options of a command.`,
  ].join('\n');
}

/** Help for a group such as "feature": its subcommands. */
export function groupHelp(group: string, entries: HelpEntry[]): string {
  return [
    `Usage: ${TOOL_NAME} ${group} <command> [options]`,
    '',
    'Commands:',
    commandRows(entries),
    '',
    `Run "${TOOL_NAME} help ${group} <command>" for the arguments and options of a command.`,
  ].join('\n');
}

export function commandHelp(entry: HelpEntry): string {
  const sections = [`Usage: ${TOOL_NAME} ${signature(entry)} [options]`, '', entry.description];
  if (entry.args && entry.args.length > 0) {
    sections.push('', 'Arguments:', formatRows(entry.args.map((arg) => [arg.name, arg.description])));
  }
  if (Object.keys(entry.options).length > 0) {
    sections.push('', 'Options:', formatRows(optionRows(entry.options)));
  }
  sections.push('', 'Global options:', formatRows(optionRows(GLOBAL_OPTIONS)));
  return sections.join('\n');
}
