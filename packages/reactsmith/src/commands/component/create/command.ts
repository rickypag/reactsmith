import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { planComponentCreate } from '../../../shared/components/create.js';
import { componentScope, ownerFromOptions } from '../../../shared/components/scope.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError, type Issue } from '../../../shared/issues.js';
import { toPascalCase } from '../../../shared/naming.js';
import { parseGap, parsePadding } from '../../../shared/styles/layout.js';
import { APP, DRY_RUN, FEATURE, FROM, INTERFACE, LAYOUT, TEXT } from '../../../shared/options.js';

export const componentCreateCommand = defineCommand({
  name: 'component create',
  description: 'Create a component in a feature, in the app, or shared by type (buttons, cards…), with its style file',
  args: [{ name: 'name', description: 'Component name, e.g. "Sidebar"', required: true }],
  options: {
    feature: FEATURE,
    app: APP,
    type: { type: 'string', placeholder: 'type', description: 'Create a shared component of this type instead, e.g. buttons: src/components/buttons/<Name>' },
    interface: INTERFACE,
    root: { type: 'string', placeholder: 'name', description: 'The root element: any HTML tag (default: div) or component, e.g. "button" or "NavLink" when the component is just that' },
    from: FROM,
    'root-props': { type: 'string', placeholder: 'props', description: 'Props the root gets, as JSX attributes, e.g. "to={href}" passes the prop href on: values are literals or variables' },
    text: TEXT,
    direction: LAYOUT.direction,
    gap: LAYOUT.gap,
    align: LAYOUT.align,
    justify: LAYOUT.justify,
    padding: LAYOUT.padding,
    'dry-run': DRY_RUN,
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    const name = toPascalCase(args.name);
    let warnings: Issue[];
    let summary: string;
    try {
      const given = [options.direction, options.gap, options.align, options.justify, options.padding].some((value) => value !== undefined);
      // Without layout options, the planner uses the default layout, or none for a root that holds text. With some, only
      // those: a design that says "row, no gap" gets no gap it didn't ask for.
      const layout = given
        ? {
            direction: options.direction,
            gap: options.gap === undefined ? undefined : parseGap(options.gap),
            align: options.align,
            justify: options.justify,
            padding: options.padding === undefined ? undefined : parsePadding(options.padding),
          }
        : undefined;
      const owner = ownerFromOptions(options.feature, options.app, options.type);
      const config = await requireConfig(cwd);
      warnings = await planComponentCreate(changes, config, { owner, name, interface: options.interface, props: options.rootProps, layout, root: options.root, from: options.from, text: options.text });
      summary = `Component "${name}" created in ${componentScope(config, owner).label}.`;
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return {
      ok: true,
      dryRun: options.dryRun,
      actions: changes.actions,
      issues: warnings,
      summary,
    };
  },
});
