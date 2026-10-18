import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { INSERT_POSITIONS } from '../../../shared/components/insert.js';
import { requireConfig } from '../../../shared/config/load.js';
import { planElementInsert } from '../../../shared/elements/insert.js';
import { IssueError } from '../../../shared/issues.js';
import { ALIGNS, DIRECTIONS, JUSTIFIES, parseGap, parsePadding, type RootStyle } from '../../../shared/styles/layout.js';

export const elementInsertCommand = defineCommand({
  name: 'element insert',
  description: 'Insert an HTML layout or text element into a layout element of a component, view or layout',
  args: [{ name: 'tag', description: 'The element: a layout element ("div", "nav"…) or a text element ("span", "h1", "a"…)', required: true }],
  options: {
    into: { type: 'string', placeholder: 'target', description: 'The element: an id, or "path/to/File.tsx:line[:column]"', required: true },
    position: { type: 'string', values: INSERT_POSITIONS, description: 'Last child (inside, the default), first child, or a sibling before or after the element' },
    text: { type: 'string', placeholder: 'text', description: 'The text of a text element' },
    href: { type: 'string', placeholder: 'url', description: 'The link of an "a"' },
    name: { type: 'string', placeholder: 'style', description: 'A style for the element, e.g. "brand": its class and rule in the style file' },
    direction: { type: 'string', values: DIRECTIONS, description: 'Layout element: how it lays out its children (needs --name)' },
    gap: { type: 'string', placeholder: 'step', description: 'Layout element: space between children, in steps of 0.25rem (needs --name)' },
    align: { type: 'string', values: ALIGNS, description: 'Layout element: alignment of the children (needs --name)' },
    justify: { type: 'string', values: JUSTIFIES, description: 'Layout element: distribution of the children (needs --name)' },
    padding: { type: 'string', placeholder: 'steps', description: 'Layout element: space inside, "4" or "2 4" (needs --name)' },
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let inserted;
    try {
      const style: RootStyle = {};
      if (options.direction !== undefined) style.direction = options.direction;
      if (options.gap !== undefined) style.gap = parseGap(options.gap);
      if (options.align !== undefined) style.align = options.align;
      if (options.justify !== undefined) style.justify = options.justify;
      if (options.padding !== undefined) style.padding = parsePadding(options.padding);
      const config = await requireConfig(cwd);
      inserted = await planElementInsert(changes, config, {
        tag: args.tag,
        target: options.into,
        position: options.position ?? 'inside',
        text: options.text,
        href: options.href,
        name: options.name,
        style: Object.keys(style).length ? style : undefined,
      });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `Inserted <${args.tag}> into ${inserted.file}.`, data: { ...inserted } };
  },
});
