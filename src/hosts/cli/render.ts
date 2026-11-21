import { styleText } from 'node:util';
import { hasErrors, type ChangeAction, type ChangeType, type CommandResult, type Issue } from '../../core/result.js';
import type { CommandIO } from './io.js';

const ACTION_LABELS: Record<ChangeType, string> = {
  create: styleText('green', '+ create'),
  update: styleText('yellow', '~ update'),
  move: styleText('cyan', '→ move  '),
  delete: styleText('red', '- delete'),
  skip: styleText('dim', '= skip  '),
  todo: styleText(['magenta', 'bold'], '! todo  '),
};

function formatAction(action: ChangeAction): string {
  return `${ACTION_LABELS[action.type]}  ${styleText('cyan', action.path)}  ${action.message}`;
}

function formatIssue(issue: Issue): string {
  const label =
    issue.severity === 'error' ? styleText(['red', 'bold'], '✖ error  ') : styleText(['yellow', 'bold'], '⚠ warning');
  const lines = [`${label} ${issue.message} ${styleText('dim', `(${issue.code})`)}`];
  if (issue.path) lines.push(`          ${styleText('cyan', issue.path)}`);
  if (issue.hint) lines.push(`          ${styleText('dim', '→')} ${issue.hint}`);
  return lines.join('\n');
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function summaryLine(issues: Issue[], successMessage: string): string {
  if (issues.length === 0) return styleText('green', `✔ ${successMessage}`);
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const summary = `${plural(errors, 'error')}, ${plural(issues.length - errors, 'warning')}`;
  return hasErrors(issues) ? styleText('red', `✖ ${summary}.`) : styleText('yellow', `✔ Valid with ${summary}.`);
}

/** Shows a command result as text (or JSON) and returns the exit code. */
export function renderResult(io: CommandIO, result: CommandResult, json: boolean): number {
  const code = result.ok ? 0 : 1;
  if (json) {
    io.log(JSON.stringify(result, null, 2));
    return code;
  }

  const { actions = [], issues = [] } = result;
  if (result.dryRun) io.log(styleText('bold', 'Dry run: nothing was written.\n'));
  for (const action of actions) io.log(formatAction(action));
  if (actions.length > 0) io.log('');
  for (const issue of issues) io.log(`${formatIssue(issue)}\n`);

  // A dry run has not been checked yet, so there is nothing to summarize unless it failed.
  if (!result.dryRun || issues.length > 0) io.log(summaryLine(issues, result.summary ?? 'Done.'));
  return code;
}
