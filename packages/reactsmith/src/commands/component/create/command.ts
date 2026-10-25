import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { planComponentCreate } from '../../../shared/components/create.js';
import { componentScope, ownerFromOptions } from '../../../shared/components/scope.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError, type Issue } from '../../../shared/issues.js';
import { toPascalCase } from '../../../shared/naming.js';
import { ALIGNS, DEFAULT_LAYOUT, DIRECTIONS, JUSTIFIES, parseGap, parsePadding } from '../../../shared/styles/layout.js';

export const componentCreateCommand = defineCommand({
  name: 'component create',
  description: 'Create a component in a feature or in the app, with its style file',
  args: [{ name: 'name', description: 'Component name, e.g. "Sidebar"', required: true }],
  options: {
    feature: { type: 'string', placeholder: 'name', description: 'The feature the component belongs to' },
    app: { type: 'boolean', description: 'Create an app component (layout parts such as a top bar) instead' },
    interface: {
      type: 'string',
      placeholder: 'members',
      description: "The component's props, as TypeScript interface members, e.g. \"items: NavItem[]; collapsed?: boolean\"",
    },
    root: { type: 'string', placeholder: 'name', description: 'The root element: any HTML tag (default: div) or component, e.g. "button" or "NavLink" when the component is just that' },
    from: { type: 'string', placeholder: 'source', description: 'Where a component root comes from, when the name is not enough: "app", a feature, "shared", or a package' },
    props: { type: 'string', placeholder: 'props', description: 'Props of the root, as JSX attributes, e.g. "to={href}": values are literals or variables' },
    text: { type: 'string', placeholder: 'text', description: 'The text of a text or interactive root, e.g. --root button --text "Read the docs", or "{label}" to show the prop label' },
    direction: { type: 'string', values: DIRECTIONS, description: 'How the root lays out its children (default: column)' },
    gap: { type: 'string', placeholder: 'step', description: 'Space between children, in spacing steps of 0.25rem (default: 2)' },
    align: { type: 'string', values: ALIGNS, description: 'Alignment of the children across the direction' },
    justify: { type: 'string', values: JUSTIFIES, description: 'Distribution of the children along the direction' },
    padding: { type: 'string', placeholder: 'steps', description: 'Space inside the root: one step for all sides ("4") or vertical and horizontal ("2 4")' },
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    const name = toPascalCase(args.name);
    let warnings: Issue[];
    let summary: string;
    try {
      const given = [options.direction, options.gap, options.align, options.justify, options.padding].some((value) => value !== undefined);
      // Without layout options, the planner uses the default layout, or none for a root that holds text.
      const layout = given
        ? {
            direction: options.direction ?? DEFAULT_LAYOUT.direction,
            gap: options.gap === undefined ? DEFAULT_LAYOUT.gap : parseGap(options.gap),
            align: options.align,
            justify: options.justify,
            padding: options.padding === undefined ? undefined : parsePadding(options.padding),
          }
        : undefined;
      const owner = ownerFromOptions(options.feature, options.app);
      const config = await requireConfig(cwd);
      warnings = await planComponentCreate(changes, config, { owner, name, interface: options.interface, props: options.props, layout, root: options.root, from: options.from, text: options.text });
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
