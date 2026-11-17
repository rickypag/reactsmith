import { cp, lstat, mkdtemp, readFile, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { styleText } from 'node:util';
import type { Command } from '../../../core/command.js';
import type { CommandResult } from '../../../core/result.js';
import type { Issue } from '../../../shared/issues.js';
import { checkStructure } from '../../../shared/structure/check.js';
import { parseCommandArgs, UsageError } from '../parse.js';
import { renderResult } from '../render.js';
import { resolveCommand } from '../resolve.js';
import { BatchSyntaxError, splitBatch } from '../words.js';
import type { Builtin } from './types.js';

/** Options a line can't take: the batch decides where it runs and how it prints, and every line runs for real. */
const LINE_OPTIONS_REFUSED = ['--cwd', '--json', '--help', '-h', '--dry-run'];

interface PlannedLine {
  line: number;
  text: string;
  command: Command;
  args: Record<string, string | undefined>;
  options: Record<string, unknown>;
}

interface LineResult {
  line: number;
  command: string;
  result: CommandResult;
}

/** Reads every line before anything runs: a typo anywhere runs nothing. Returns the problems by line. */
function planLines(text: string, commands: Command[]): { planned: PlannedLine[]; problems: string[] } {
  const planned: PlannedLine[] = [];
  const problems: string[] = [];
  let lines;
  try {
    lines = splitBatch(text);
  } catch (error) {
    if (!(error instanceof BatchSyntaxError)) throw error;
    return { planned, problems: [`line ${error.line}: ${error.message}`] };
  }
  for (const { line, text: lineText, words } of lines) {
    // Lines copied from a terminal may start with the program's name.
    const start = words[0] === 'npx' && words[1] === 'reactsmith' ? 2 : words[0] === 'reactsmith' ? 1 : 0;
    const rest = words.slice(start);
    const refused = rest.find((word) => LINE_OPTIONS_REFUSED.includes(word));
    if (refused) {
      problems.push(`line ${line}: ${refused} applies to the whole batch, not to a line: pass it to "batch" instead.`);
      continue;
    }
    const resolution = resolveCommand(rest, commands);
    if (resolution.kind !== 'entry') {
      problems.push(`line ${line}: "${rest.slice(0, 2).join(' ')}" is not a command.`);
      continue;
    }
    try {
      const parsed = parseCommandArgs(resolution.entry, resolution.rest);
      planned.push({ line, text: lineText, command: resolution.entry, args: parsed.args, options: parsed.options });
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      problems.push(`line ${line}: ${error.message}`);
    }
  }
  if (!planned.length && !problems.length) problems.push('The batch has no commands.');
  return { planned, problems };
}

/** What a copy of the project leaves out: installed packages (linked instead), Git and build output. */
const NOT_COPIED = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo']);

/**
 * Runs the batch on a copy of the project, so every line builds on the ones before as it would for real, and nothing
 * of the project changes: the copy links the project's node_modules, for the type checks. Unlike a real batch, it goes
 * on after a refusal, so the whole plan is checked at once; a refusal after another may only follow from it. Then check
 * runs on the copy, and the issues the plan would add (import rules, unused code…) are reported with the lines.
 */
async function dryRun(cwd: string, planned: PlannedLine[]): Promise<{ results: LineResult[]; added: Issue[] }> {
  const copy = await mkdtemp(path.join(tmpdir(), 'reactsmith-dry-run-'));
  const modules = path.join(copy, 'node_modules');
  try {
    await cp(cwd, copy, { recursive: true, filter: (source) => !NOT_COPIED.has(path.basename(source)) || path.dirname(source) !== cwd });
    if (await lstat(path.join(cwd, 'node_modules')).catch(() => undefined)) await symlink(path.join(cwd, 'node_modules'), modules, 'junction');
    const key = (issue: Issue) => `${issue.code} ${issue.path ?? ''} ${issue.message}`;
    const before = new Set((await checkStructure(copy)).issues.map(key));
    const results: LineResult[] = [];
    for (const step of planned) {
      const result = await step.command.run({ cwd: copy, args: step.args as never, options: { ...step.options, dryRun: false } as never });
      results.push({ line: step.line, command: step.text, result });
    }
    const added = (await checkStructure(copy)).issues.filter((issue) => !before.has(key(issue)));
    return { results, added };
  } finally {
    // The link first, so removing the copy never reaches the project's packages.
    if (await lstat(modules).catch(() => undefined)) await unlink(modules);
    await rm(copy, { recursive: true, force: true });
  }
}

export const batchBuiltin: Builtin = {
  name: 'batch',
  description: 'Run many commands in one go, one per line, from a file or stdin; stops at the first refusal. --dry-run checks the whole plan without changing anything',
  args: [{ name: 'file', description: 'The file of commands (default: stdin)' }],
  options: {
    'dry-run': { type: 'boolean', description: 'Check the whole plan on a copy of the project, changing nothing: every refusal, and the issues check would find after it' },
  },

  async run({ io, json, args, options, cwd, commands, readStdin }) {
    const text = args.file !== undefined ? await readFile(path.resolve(cwd, args.file), 'utf8') : await readStdin();
    const { planned, problems } = planLines(text, commands);
    if (problems.length) {
      if (json) io.log(JSON.stringify({ ok: false, ran: 0, problems }, null, 2));
      else io.error(`Nothing ran: ${problems.length === 1 ? 'a line is' : 'some lines are'} not valid.\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
      return 2;
    }

    if (options.dryRun) {
      const { results, added } = await dryRun(cwd, planned);
      const refused = results.filter((entry) => !entry.result.ok);
      const errors = added.filter((issue) => issue.severity === 'error');
      const ok = !refused.length && !errors.length;
      if (json) {
        io.log(JSON.stringify({ ok, dryRun: true, ran: results.length, results, refused: refused.map((entry) => entry.line), check: added }, null, 2));
      } else {
        for (const entry of results) {
          io.log(styleText('bold', `\n[line ${entry.line}] ${entry.command}`));
          renderResult(io, entry.result, false);
        }
        if (added.length) {
          io.log(styleText('bold', '\n[check after the plan]'));
          renderResult(io, { ok: !errors.length, issues: added }, false);
        }
        const what = [refused.length ? `${refused.length} refused (line${refused.length === 1 ? '' : 's'} ${refused.map((entry) => entry.line).join(', ')}; a refusal after another may only follow from it)` : '', errors.length ? `${errors.length} check error${errors.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
        io.log(styleText(ok ? 'green' : 'red', `\n${ok ? '✔' : '✖'} Dry run of ${results.length} command${results.length === 1 ? '' : 's'}, nothing changed${what ? `: ${what}` : ': every line would run, and check would pass'}.`));
      }
      return ok ? 0 : 1;
    }

    // Each line runs on the files as the lines before left them; the first refusal stops the batch.
    const results: LineResult[] = [];
    for (const step of planned) {
      const result = await step.command.run({ cwd, args: step.args as never, options: { ...step.options, dryRun: false } as never });
      results.push({ line: step.line, command: step.text, result });
      if (!json) {
        io.log(styleText('bold', `\n[line ${step.line}] ${step.command.name}`));
        renderResult(io, result, false);
      }
      if (!result.ok) break;
    }

    const failed = results.find((entry) => !entry.result.ok);
    const notRun = planned.slice(results.length).map((step) => step.line);
    if (json) {
      io.log(JSON.stringify({ ok: !failed, ran: results.length, results, ...(failed ? { stoppedAt: failed.line, notRun } : {}) }, null, 2));
    } else if (failed) {
      io.log(styleText('red', `\n✖ Stopped at line ${failed.line}: ${results.length - 1} command${results.length === 2 ? '' : 's'} ran before it, ${notRun.length} did not run.`));
    } else {
      io.log(styleText('green', `\n✔ ${results.length} command${results.length === 1 ? '' : 's'} ran.`));
    }
    return failed ? 1 : 0;
  },
};
