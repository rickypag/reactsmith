import type { OptionSpec, OptionSpecs } from '../../core/command.js';
import { TOOL_NAME } from '../../shared/config/defaults.js';
import { GLOBAL_OPTIONS } from './parse.js';

/** Anything listed in the help: a command or a built-in. */
export interface HelpEntry {
  name: string;
  description: string;
  options: OptionSpecs;
}

function formatFlag(name: string, spec: OptionSpec): string {
  const short = spec.short ? `-${spec.short}, ` : '    ';
  const value = spec.type === 'string' ? ` <${spec.values?.join('|') ?? spec.placeholder ?? 'value'}>` : '';
  return `${short}--${name}${value}`;
}

function formatRows(rows: [string, string][]): string {
  const width = Math.max(...rows.map(([left]) => left.length)) + 3;
  return rows.map(([left, right]) => `  ${left.padEnd(width)}${right}`).join('\n');
}

function optionRows(options: OptionSpecs): [string, string][] {
  return Object.entries(options).map(([name, spec]) => [formatFlag(name, spec), spec.description]);
}

export function generalHelp(entries: HelpEntry[]): string {
  return [
    `Usage: ${TOOL_NAME} <command> [options]`,
    '',
    'Commands:',
    formatRows(entries.map((entry) => [entry.name, entry.description])),
    '',
    'Global options:',
    formatRows(optionRows(GLOBAL_OPTIONS)),
    '',
    `Run "${TOOL_NAME} <command> --help" for the options of a command.`,
  ].join('\n');
}

export function commandHelp(entry: HelpEntry): string {
  const sections = [`Usage: ${TOOL_NAME} ${entry.name} [options]`, '', entry.description];
  if (Object.keys(entry.options).length > 0) {
    sections.push('', 'Options:', formatRows(optionRows(entry.options)));
  }
  sections.push('', 'Global options:', formatRows(optionRows(GLOBAL_OPTIONS)));
  return sections.join('\n');
}
