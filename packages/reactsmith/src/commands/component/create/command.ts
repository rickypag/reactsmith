import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { planComponentCreate } from '../../../shared/components/create.js';
import { componentScope, ownerFromOptions } from '../../../shared/components/scope.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError, type Issue } from '../../../shared/issues.js';
import { toPascalCase } from '../../../shared/naming.js';
import { parseGap, parsePadding } from '../../../shared/styles/layout.js';
import { APP, DRY_RUN, FEATURE, FROM, INTERFACE, LAYOUT, TEXT } from '../../../shared/options.js';
import { parseDraft } from '../../../shared/components/draft/parse.js';
import { draftProblemIssues, readDraft, runDraft } from './draft.js';
import { findReplaceTarget } from '../../../shared/components/draft/replace.js';

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
    jsx: { type: 'string', placeholder: 'file', description: 'The whole component as the JSX it returns, from a file or "-" for stdin, with $ attributes for its styles ($name, $gap, $css…): checked before anything is written' },
    replace: { type: 'boolean', description: 'With --jsx: replace what an existing component returns, and its styles, keeping its props and the code before the return' },
    'dry-run': DRY_RUN,
  },

  async run({ cwd, args, options, readStdin }) {
    if (options.replace && options.jsx === undefined) {
      return { ok: false, issues: [{ severity: 'error', code: 'options-conflict', message: '--replace needs --jsx: the draft that replaces the JSX.', hint: 'E.g. component create ProductCard --replace --jsx draft.tsx.' }] };
    }
    if (options.jsx !== undefined) {
      const name = toPascalCase(args.name);
      try {
        const given = [
          options.replace && options.interface !== undefined && '--interface',
          options.root !== undefined && '--root',
          options.rootProps !== undefined && '--root-props',
          options.text !== undefined && '--text',
          options.from !== undefined && '--from',
          [options.direction, options.gap, options.align, options.justify, options.padding].some((value) => value !== undefined) && 'layout options',
        ].filter(Boolean);
        if (given[0] === '--interface') {
          throw new IssueError({ severity: 'error', code: 'options-conflict', message: '--replace keeps the props: --interface does not apply.', hint: `Change the props first with "component update ${name} --interface …", then replace the JSX.` });
        }
        if (given.length) {
          throw new IssueError({ severity: 'error', code: 'options-conflict', message: `With --jsx, the draft's root replaces ${given.join(' and ')}.`, hint: 'Write them on the root of the draft: its tag, props, text and $ attributes, e.g. <nav $direction="row" $gap="2">.' });
        }
        const owned = options.feature !== undefined || options.app || options.type !== undefined;
        // A replace finds the component by its name; a new one needs to know where it goes.
        const owner = options.replace && !owned ? undefined : ownerFromOptions(options.feature, options.app, options.type);
        const config = await requireConfig(cwd);
        const { root, problems } = parseDraft(await readDraft(cwd, options.jsx, readStdin));
        if (!root) return { ok: false, issues: draftProblemIssues(problems), summary: 'Nothing was written: fix the draft and run the command again.' };
        const replace = options.replace ? await findReplaceTarget(new ChangeSet(cwd), config, name, owner) : undefined;
        const fileRel = replace?.fileRel ?? `${componentScope(config, owner!).componentsRel}/${name}/${name}.tsx`;
        const srcRel = fileRel.startsWith(`${config.srcDir}/`) ? fileRel.slice(config.srcDir.length + 1) : fileRel;
        return await runDraft({ cwd, config, owner: owner!, name, interface: options.interface, root, fileRel, srcRel, dryRun: options.dryRun, replace });
      } catch (error) {
        if (!(error instanceof IssueError)) throw error;
        return { ok: false, issues: error.issues };
      }
    }
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
