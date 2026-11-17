import { defineCommand } from '../../core/command.js';
import { ChangeSet } from '../../shared/changes.js';
import { requireConfig } from '../../shared/config/load.js';
import { planMessages } from '../../shared/i18n/set.js';
import { IssueError } from '../../shared/issues.js';
import { DRY_RUN } from '../../shared/options.js';

export const messagesCommand = defineCommand({
  name: 'messages',
  description:
    'Set the translated texts of the app, one language at a time, in its message file (messages/<language>.json): keys grouped by the component that shows them. ' +
    'Elements show them with "element insert … --message <key>"',
  options: {
    set: { type: 'string', placeholder: 'key=text', description: 'Keys and their texts, separated by ";" (write "\\;" for a ";" in a text), e.g. "TopBar.workshops=Workshops; TopBar.register=Register"' },
    locale: { type: 'string', placeholder: 'language', description: 'The language of the --set texts, e.g. "en": a new language gets its file' },
    remove: { type: 'string', placeholder: 'keys', description: 'Keys or groups to remove from every language, separated by ";": refused while an element shows them' },
    'dry-run': DRY_RUN,
  },

  async run({ cwd, options }) {
    const changes = new ChangeSet(cwd);
    let changed: string[];
    try {
      const config = await requireConfig(cwd);
      changed = await planMessages(changes, config, { set: options.set, locale: options.locale, remove: options.remove });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    const summary = changed.length ? `Messages updated: ${changed.join(', ')}.` : 'The messages already have these texts.';
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary, data: { changed } };
  },
});
