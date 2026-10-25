import type { ChangeSet } from '../changes.js';
import { cut, isStillUsed, removalRange, removeImport } from '../code/remove.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';
import { resolveTarget } from './ids.js';
import { allNodes } from './tree.js';

export interface ElementRemoveResult {
  /** The removed element's id. */
  id: string;
  tag: string;
  /** Project-relative path of the edited file. */
  file: string;
}

/**
 * Plans removing an element, given by id or "file:line[:column]", with everything inside it: an HTML element,
 * a component, or a list. Its parent must hold elements (a layout or interactive element), so the code stays valid.
 * Imports of components that are no longer used in the file are removed too; their files are kept.
 */
export async function planElementRemove(changes: ChangeSet, config: ResolvedConfig, target: string): Promise<ElementRemoveResult> {
  const { id, file, element, tree } = await resolveTarget(changes.root, config, target);
  if (element.kind === 'slot') {
    throw new IssueError({ severity: 'error', code: 'remove-not-an-element', path: file, message: `${id} is a prop, not an element.`, hint: 'Remove the elements inside it, or edit the prop by hand.' });
  }
  const parent = allNodes(tree.roots).find((node) => node.children.includes(element));
  if (!parent?.layout) {
    const where = parent ? `"${parent.tag}", which holds no elements` : 'the root of the component';
    throw new IssueError({
      severity: 'error',
      code: 'remove-parent-not-layout',
      path: file,
      message: `"${element.tag}" is in ${where}, so removing it would leave invalid code.`,
      hint: 'Elements can be removed only from layout elements (div, nav…) and interactive ones (a, button…).',
    });
  }

  const sourceFile = tree.sourceFile;
  const text = sourceFile.getFullText();
  let updated = cut(text, removalRange(text, element.node.getStart(sourceFile), element.node.getEnd()));
  // Components used inside the removed element may now be unused in the file.
  const components = new Set(
    allNodes([element])
      .map((node) => (node.kind === 'list' ? node.component : node.kind === 'element' ? node.tag : undefined))
      .filter((tag): tag is string => tag !== undefined && /^[A-Z]/.test(tag) && !tag.includes('.')),
  );
  const imports: string[] = [];
  for (const name of components) {
    if (isStillUsed(updated, name)) continue;
    updated = removeImport(updated, name);
    imports.push(name);
  }

  const dropped = imports.length ? ` and the import of ${imports.join(', ')}` : '';
  const what = element.kind === 'list' ? `the list ${element.tag} of <${element.component ?? '?'}>` : `<${element.tag}>`;
  changes.write(file, updated, { type: 'update', message: `removed ${what} from ${parent.path}${dropped}` });
  return { id, tag: element.tag, file };
}
