import type { CommandResult } from '../../core/result.js';
import { readPackageVersion } from '../../shared/package.js';

export const ISSUES_URL = 'https://github.com/rickypag/reactsmith/issues';

/**
 * A command that throws is a ReactSmith bug, not a refusal: the result says so, in the shape every result has, so an
 * agent reading `--json` can tell it apart and report it. Commands plan in memory and write at the end, so a throw
 * leaves the files as they were.
 */
export function internalError(error: unknown, command: string): CommandResult {
  const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return {
    ok: false,
    summary: 'ReactSmith crashed: this is a bug in ReactSmith, not in the request.',
    issues: [
      {
        severity: 'error',
        code: 'internal-error',
        message: `"${command}" crashed (ReactSmith ${readPackageVersion()}): ${error instanceof Error ? error.message : String(error)}`,
        hint: `This is a ReactSmith bug. Make the change by hand if it can't wait, run check, and report the command with this output at ${ISSUES_URL}.\n${stack}`,
      },
    ],
  };
}

/**
 * Runs a command, turning a throw into an internal-error result. A refused command writes nothing, so the changes it
 * had planned before the refusal are not listed: they would read as done.
 */
export async function runSafely(command: string, run: () => Promise<CommandResult>): Promise<CommandResult> {
  try {
    const result = await run();
    return result.ok || !result.actions ? result : { ...result, actions: [] };
  } catch (error) {
    return internalError(error, command);
  }
}
