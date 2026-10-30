import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { parseCss, parseStyleObject, STYLE_STATES, type StyleInput } from '../../../shared/styles/declarations.js';
import { parseGap, parsePadding } from '../../../shared/styles/layout.js';
import { planStyleUpdate, type LayoutChanges } from '../../../shared/styles/update.js';
import { DRY_RUN, LAYOUT_UPDATE, STYLE_NAME } from '../../../shared/options.js';

const NONE = 'none';

function optionError(code: string, message: string, hint: string): IssueError {
  return new IssueError({ severity: 'error', code, message, hint });
}

async function readInputFile(cwd: string, file: string): Promise<string> {
  try {
    return await readFile(path.resolve(cwd, file), 'utf8');
  } catch {
    throw new IssueError({ severity: 'error', code: 'style-file-missing', path: file, message: `Cannot read "${file}".`, hint: 'Check the path, relative to the project root.' });
  }
}

export const styleUpdateCommand = defineCommand({
  name: 'style update',
  description: "Update an element's style: layout options, CSS, a style object, or Tailwind classes",
  args: [{ name: 'target', description: 'The element: an id, or "path/to/File.tsx:line[:column]"', required: true }],
  options: {
    name: STYLE_NAME,
    state: { type: 'string', values: STYLE_STATES, description: 'Apply the declarations to a state, e.g. hover' },
    when: { type: 'string', placeholder: 'prop', description: 'Apply the declarations when a prop of the component is true (--when selected) or has a value (--when status=Error)' },
    css: { type: 'string', placeholder: 'declarations', description: 'CSS declarations, e.g. "display: inline-flex; gap: 9px; &:hover { opacity: 0.8 }"' },
    'css-file': { type: 'string', placeholder: 'path', description: 'A file with CSS declarations, e.g. a snippet from the design team' },
    object: { type: 'string', placeholder: 'object', description: "A style object as in React's style prop, e.g. \"{ display: 'inline-flex', gap: 9 }\"" },
    'object-file': { type: 'string', placeholder: 'path', description: 'A file with a style object' },
    class: { type: 'string', placeholder: 'classes', description: 'Tailwind classes that replace the style\'s classes, e.g. "inline-flex gap-2 hover:underline"' },
    direction: LAYOUT_UPDATE.direction,
    gap: LAYOUT_UPDATE.gap,
    align: LAYOUT_UPDATE.align,
    justify: LAYOUT_UPDATE.justify,
    padding: LAYOUT_UPDATE.padding,
    'dry-run': DRY_RUN,
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let updated;
    try {
      const inputs = { css: options.css, 'css-file': options.cssFile, object: options.object, 'object-file': options.objectFile, class: options.class };
      const given = Object.entries(inputs).filter(([, value]) => value !== undefined).map(([key]) => `--${key}`);
      if (given.length > 1) throw optionError('options-conflict', `${given.join(' and ')} cannot be used together.`, 'Pass the style one way.');

      const layout: LayoutChanges = {};
      if (options.direction !== undefined) layout.direction = options.direction === NONE ? null : options.direction;
      if (options.gap !== undefined) layout.gap = options.gap === NONE ? null : parseGap(options.gap);
      if (options.align !== undefined) layout.align = options.align === NONE ? null : options.align;
      if (options.justify !== undefined) layout.justify = options.justify === NONE ? null : options.justify;
      if (options.padding !== undefined) layout.padding = options.padding === NONE ? null : parsePadding(options.padding);
      const hasLayout = Object.keys(layout).length > 0;

      if (given.length === 0 && !hasLayout) {
        throw optionError('style-nothing', 'No style given.', 'Pass --css, --css-file, --object, --object-file or --class, or layout options such as --gap.');
      }
      if (hasLayout && options.class !== undefined) throw optionError('options-conflict', '--class replaces all the classes, so it cannot be combined with layout options.', 'Write the layout as classes too, e.g. "flex gap-2".');
      if (hasLayout && options.state !== undefined) throw optionError('options-conflict', 'Layout options apply to the element itself, not to a state.', 'Leave out --state, or pass the declarations with --css.');
      if (options.class !== undefined && options.state !== undefined) throw optionError('options-conflict', '--class already writes states as prefixes, e.g. "hover:underline".', 'Leave out --state.');

      let input: StyleInput | undefined;
      if (options.css !== undefined) input = parseCss(options.css);
      if (options.cssFile !== undefined) input = parseCss(await readInputFile(cwd, options.cssFile));
      if (options.object !== undefined) input = parseStyleObject(options.object);
      if (options.objectFile !== undefined) input = parseStyleObject(await readInputFile(cwd, options.objectFile));

      const config = await requireConfig(cwd);
      updated = await planStyleUpdate(changes, config, {
        target: args.target,
        name: options.name,
        state: options.state,
        layout: hasLayout ? layout : undefined,
        input,
        classes: options.class,
        when: options.when,
      });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `Updated the style "${updated.style}" in ${updated.file}.`, data: { ...updated } };
  },
});
