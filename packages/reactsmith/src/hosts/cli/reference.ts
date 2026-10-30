import type { OptionSpec, OptionSpecs } from '../../core/command.js';
import { TOOL_NAME } from '../../shared/config/defaults.js';
import type { HelpEntry } from './help.js';
import { GLOBAL_OPTIONS } from './parse.js';

function flag(name: string, spec: OptionSpec): string {
  const value = spec.type === 'string' ? ` <${spec.values?.join('|') ?? spec.placeholder ?? 'value'}>` : '';
  return `${spec.short ? `-${spec.short}, ` : ''}--${name}${value}`;
}

function optionLines(options: OptionSpecs): string[] {
  return Object.entries(options).map(([name, spec]) => `- \`${flag(name, spec)}\`: ${spec.description}${spec.type === 'string' && spec.required ? ' (required)' : ''}`);
}

/** "element insert <name>", "help [command...]" */
function signature(entry: HelpEntry): string {
  const args = (entry.args ?? []).map((arg) => `${arg.required ? '<' : '['}${arg.name}${arg.variadic ? '...' : ''}${arg.required ? '>' : ']'}`);
  return [TOOL_NAME, entry.name, ...args].join(' ');
}

/**
 * The reference of every command as Markdown, from the same definitions as the help: what the skill gives
 * Claude, so it never describes options the installed CLI doesn't have.
 */
export function commandReference(entries: HelpEntry[]): string {
  const sections = [
    '# ReactSmith commands',
    '',
    '<!-- Generated from the CLI\'s command definitions by "npm run build". Do not edit: changes are lost. -->',
    '',
    `Every command takes these options. Use \`--json\` when a program reads the output: it never prompts.`,
    '',
    ...optionLines(GLOBAL_OPTIONS),
  ];
  for (const entry of entries) {
    sections.push('', `## ${entry.name}`, '', '```', signature(entry), '```', '', `${entry.description}.`);
    if (entry.args?.length) sections.push('', 'Arguments:', '', ...entry.args.map((arg) => `- \`${arg.name}\`: ${arg.description}`));
    if (Object.keys(entry.options).length) sections.push('', 'Options:', '', ...optionLines(entry.options));
  }
  return `${sections.join('\n')}\n`;
}
