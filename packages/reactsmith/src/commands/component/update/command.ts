import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { componentScope, ownerFromOptions } from '../../../shared/components/scope.js';
import { planComponentUpdate, type RootStyleChanges } from '../../../shared/components/update.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { toPascalCase } from '../../../shared/naming.js';
import { parseDeclarations } from '../../../shared/styles/declarations.js';
import { ALIGNS, DIRECTIONS, JUSTIFIES, parseGap, parsePadding } from '../../../shared/styles/layout.js';

const NONE = 'none';

async function readCssFile(cwd: string, file: string): Promise<string> {
  try {
    return await readFile(path.resolve(cwd, file), 'utf8');
  } catch {
    throw new IssueError({ severity: 'error', code: 'css-file-missing', path: file, message: `Cannot read the CSS file "${file}".`, hint: 'Check the path, relative to the project root.' });
  }
}

export const componentUpdateCommand = defineCommand({
  name: 'component update',
  description: 'Update the root style of a component: layout options, or CSS declarations given as they are',
  args: [{ name: 'name', description: 'Component name, e.g. "TopBar"', required: true }],
  options: {
    feature: { type: 'string', placeholder: 'name', description: 'The feature the component belongs to' },
    app: { type: 'boolean', description: 'Update an app component instead' },
    direction: { type: 'string', values: [...DIRECTIONS, NONE], description: 'How the root lays out its children' },
    gap: { type: 'string', placeholder: 'step', description: 'Space between children, in spacing steps of 0.25rem, or "none"' },
    align: { type: 'string', values: [...ALIGNS, NONE], description: 'Alignment of the children across the direction' },
    justify: { type: 'string', values: [...JUSTIFIES, NONE], description: 'Distribution of the children along the direction' },
    padding: { type: 'string', placeholder: 'steps', description: 'Space inside the root: "4", vertical and horizontal "2 4", or "none"' },
    css: { type: 'string', placeholder: 'declarations', description: 'CSS declarations to set as given, e.g. "display: inline-flex; gap: 9px" (with or without { })' },
    'css-file': { type: 'string', placeholder: 'path', description: 'A file with the CSS declarations, e.g. a snippet from the design team' },
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    const name = toPascalCase(args.name);
    let summary: string;
    try {
      const style: RootStyleChanges = {};
      if (options.direction !== undefined) style.direction = options.direction === NONE ? null : options.direction;
      if (options.gap !== undefined) style.gap = options.gap === NONE ? null : parseGap(options.gap);
      if (options.align !== undefined) style.align = options.align === NONE ? null : options.align;
      if (options.justify !== undefined) style.justify = options.justify === NONE ? null : options.justify;
      if (options.padding !== undefined) style.padding = options.padding === NONE ? null : parsePadding(options.padding);

      if (options.css !== undefined && options.cssFile !== undefined) {
        throw new IssueError({ severity: 'error', code: 'options-conflict', message: '--css and --css-file cannot be used together.', hint: 'Pass the declarations one way.' });
      }
      const cssText = options.cssFile === undefined ? options.css : await readCssFile(cwd, options.cssFile);
      const css = cssText === undefined ? undefined : parseDeclarations(cssText);

      const owner = ownerFromOptions(options.feature, options.app);
      const config = await requireConfig(cwd);
      await planComponentUpdate(changes, config, { owner, name, style, css });
      summary = `Updated the root style of "${name}" in ${componentScope(config, owner).label}.`;
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary };
  },
});
