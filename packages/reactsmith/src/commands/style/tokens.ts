import { defineCommand } from '../../core/command.js';
import { ChangeSet } from '../../shared/changes.js';
import { requireConfig } from '../../shared/config/load.js';
import { IssueError } from '../../shared/issues.js';
import { planTokenImports } from '../../shared/styles/global.js';
import { planTokens, setAndRemove, tokenUsages, type TokenKind } from '../../shared/tokens/engine.js';
import { DRY_RUN } from '../../shared/options.js';

/** The options every token command shares: --set, --mode and --remove, with examples for its kind. */
export const TOKEN_OPTIONS = (file: string, example: string, mode: string) =>
  ({
    set: { type: 'string', placeholder: 'path=value', description: `Tokens to add or change in tokens/${file}.json, separated by ";": a path in the hierarchy and a value, a token or a CSS expression, e.g. "${example}"` },
    mode: { type: 'string', placeholder: 'mode', description: `The mode the --set values are for, e.g. ${mode} (default: every mode)` },
    remove: { type: 'string', placeholder: 'paths', description: 'Tokens or groups to remove, separated by ";": refused while a style or another token uses them' },
  }) as const;

/**
 * The command of a kind of tokens: --set, --mode and --remove on tokens/<kind>.json, which writes its CSS and its
 * type; with no option, it writes them again from the JSON (and moves the kind out of an older global.css).
 */
export function tokenCommand(kind: TokenKind, what: string, example: string, label: string) {
  return defineCommand({
    name: kind.command,
    description: `Set the ${what} of the app (tokens/${kind.file}.json, any hierarchy): only the given ones change; with no option, it writes the CSS and the type again from ${kind.file}.json`,
    options: {
      ...TOKEN_OPTIONS(kind.file, example, kind.defaultModes[1] ?? kind.defaultModes[0]!),
      'dry-run': DRY_RUN,
    },

    async run({ cwd, options }) {
      const changes = new ChangeSet(cwd);
      let changed: string[];
      try {
        const config = await requireConfig(cwd);
        const usages = options.remove ? await tokenUsages(kind, (fileRel) => changes.read(fileRel), cwd, config) : new Map<string, string[]>();
        const { edit } = setAndRemove(kind, options, usages);
        changed = await planTokens(changes, config, kind, edit);
        await planTokenImports(changes, config);
      } catch (error) {
        if (!(error instanceof IssueError)) throw error;
        return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
      }

      if (!options.dryRun) await changes.apply();
      const written = changes.actions.some((action) => action.type !== 'skip');
      const summary = changed.length ? `${label} updated: ${changed.join(', ')}.` : written ? `${label} written from ${kind.file}.json.` : `The ${what} already has these values.`;
      return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary, data: { changed } };
    },
  });
}
