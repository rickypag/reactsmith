import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { INSERT_POSITIONS } from '../../../shared/elements/position.js';
import { requireConfig } from '../../../shared/config/load.js';
import { planElementInsert } from '../../../shared/elements/insert.js';
import { IssueError } from '../../../shared/issues.js';
import { ALIGNS, DIRECTIONS, JUSTIFIES, parseGap, parsePadding, type RootStyle } from '../../../shared/styles/layout.js';

export const elementInsertCommand = defineCommand({
  name: 'element insert',
  description: 'Insert an HTML element or a component (of the project or of a package) into a component, view or layout, or around elements to wrap them',
  args: [{ name: 'name', description: 'What to insert: an HTML tag ("div", "span", "a", "img"…) or a component ("NavMenu", "NavLink"…)', required: true }],
  options: {
    into: { type: 'string', placeholder: 'target', description: 'Where: an element id, or "path/to/File.tsx:line[:column]"' },
    position: { type: 'string', values: INSERT_POSITIONS, description: 'Last child (inside, the default), first child, or a sibling before or after the element' },
    around: { type: 'string', placeholder: 'target', description: 'Instead of --into: wrap this element in the new one, which takes its place' },
    through: { type: 'string', placeholder: 'target', description: 'With --around: wrap the siblings from the --around element through this one' },
    from: { type: 'string', placeholder: 'source', description: 'Where the component comes from, when the name is not enough: "app", a feature, "shared", or a package' },
    props: { type: 'string', placeholder: 'props', description: 'Props as JSX attributes, e.g. \'to="/docs"\' or "to={href}": values are literals or variables of the file' },
    text: { type: 'string', placeholder: 'text', description: 'The text of a text or interactive element; "{label}" shows a prop, constant or import, e.g. "Hello, {user.name}!"' },
    name: { type: 'string', placeholder: 'style', description: 'A style for the element, e.g. "brand": its class and rule in the style file' },
    direction: { type: 'string', values: DIRECTIONS, description: 'Layout element: how it lays out its children (needs --name)' },
    gap: { type: 'string', placeholder: 'step', description: 'Layout element: space between children, in steps of 0.25rem (needs --name)' },
    align: { type: 'string', values: ALIGNS, description: 'Layout element: alignment of the children (needs --name)' },
    justify: { type: 'string', values: JUSTIFIES, description: 'Layout element: distribution of the children (needs --name)' },
    padding: { type: 'string', placeholder: 'steps', description: 'Layout element: space inside, "4" or "2 4" (needs --name)' },
    each: { type: 'string', placeholder: 'list', description: 'Repeat a component for each item of a list, e.g. --each links (needs --as and --key)' },
    as: { type: 'string', placeholder: 'name', description: 'The name of each item, usable in --key and --props, e.g. --as link' },
    key: { type: 'string', placeholder: 'path', description: "A unique value of each item, React's key, e.g. --key link.href" },
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

      const listOptions = { each: options.each, as: options.as, key: options.key };
      const given = Object.entries(listOptions).filter(([, value]) => value !== undefined);
      if (given.length > 0 && given.length < 3) {
        const missing = Object.keys(listOptions).filter((key) => listOptions[key as keyof typeof listOptions] === undefined);
        throw new IssueError({
          severity: 'error',
          code: 'list-options-incomplete',
          message: `A list needs --each, --as and --key: ${missing.map((key) => `--${key}`).join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing.`,
          hint: 'E.g. --each links --as link --key link.href.',
        });
      }

      const conflict = (message: string, hint: string) => new IssueError({ severity: 'error', code: 'options-conflict', message, hint });
      if ((options.into === undefined) === (options.around === undefined)) {
        throw conflict(options.into === undefined ? 'Where should it go? Pass --into or --around.' : '--into and --around cannot be used together.', 'Use --into <target> to insert into an element (or next to it, with --position), or --around <target> to wrap it.');
      }
      if (options.around !== undefined && options.position !== undefined) throw conflict('--position and --around cannot be used together.', 'The new element takes the place of what it wraps.');
      if (options.through !== undefined && options.around === undefined) throw conflict('--through needs --around.', 'E.g. --around <first> --through <last> wraps the siblings from first to last.');

      const config = await requireConfig(cwd);
      inserted = await planElementInsert(changes, config, {
        tag: args.name,
        target: (options.into ?? options.around)!,
        position: options.around !== undefined ? 'around' : (options.position ?? 'inside'),
        through: options.through,
        from: options.from,
        props: options.props,
        text: options.text,
        name: options.name,
        style: Object.keys(style).length ? style : undefined,
        list: given.length === 3 ? { each: options.each!, as: options.as!, key: options.key! } : undefined,
      });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `${args.name.startsWith('{') ? `Rendered the prop ${args.name} in` : options.around !== undefined ? `Wrapped elements in <${args.name}> in` : `Inserted <${args.name}> into`} ${inserted.file}${inserted.id ? `: ${inserted.id}` : ''}.`, data: { ...inserted } };
  },
});
