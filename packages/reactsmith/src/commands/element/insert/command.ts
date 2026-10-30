import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { planElementInsert } from '../../../shared/elements/insert.js';
import { IssueError } from '../../../shared/issues.js';
import { parseGap, parsePadding, type RootStyle } from '../../../shared/styles/layout.js';
import { DRY_RUN, FALLBACK, FROM, IF, INTO, LAYOUT, POSITION, PROPS, STYLE_NAME, TEXT, THROUGH } from '../../../shared/options.js';

export const elementInsertCommand = defineCommand({
  name: 'element insert',
  description: 'Insert an HTML element or a component (of the project or of a package) into a component, view or layout, or around elements to wrap them; "{?open}" --around puts an element in a condition',
  args: [{ name: 'name', description: 'What to insert: an HTML tag ("div", "span", "a", "img"…), a component ("NavMenu", "NavLink"…), a prop holding a component ("{icon}"), or a condition ("{?open}", with --around)', required: true }],
  options: {
    into: INTO,
    position: POSITION,
    around: { type: 'string', placeholder: 'target', description: 'Instead of --into: wrap this element in the new one, which takes its place' },
    through: THROUGH,
    from: FROM,
    props: PROPS,
    text: TEXT,
    name: STYLE_NAME,
    direction: LAYOUT.direction,
    gap: LAYOUT.gap,
    align: LAYOUT.align,
    justify: LAYOUT.justify,
    padding: LAYOUT.padding,
    if: IF,
    fallback: FALLBACK,
    each: { type: 'string', placeholder: 'list', description: 'Repeat a component for each item of a list, e.g. --each links (needs --as and --key)' },
    as: { type: 'string', placeholder: 'name', description: 'The name of each item, usable in --key and --props, e.g. --as link' },
    key: { type: 'string', placeholder: 'path', description: "A unique value of each item, React's key, e.g. --key link.href" },
    'dry-run': DRY_RUN,
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
        if: options.if,
        fallback: options.fallback,
      });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `${args.name.startsWith('{?') ? `Put the element in the condition ${args.name} in` : args.name.startsWith('{') ? `Rendered the prop ${args.name} in` : options.around !== undefined ? `Wrapped elements in <${args.name}> in` : `Inserted <${args.name}> into`} ${inserted.file}${inserted.id ? `: ${inserted.id}` : ''}.`, data: { ...inserted } };
  },
});
