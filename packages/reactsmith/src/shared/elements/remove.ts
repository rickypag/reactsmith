import type { ChangeSet } from '../changes.js';
import { cut, isStillUsed, removalRange, removeImport } from '../components/remove.js';
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
 * Plans removing an element, given by id or "file:line[:column]", with everything inside it.
 * Its parent must be a layout element, so the code stays valid. Imports of components that are
 * no longer used in the file are removed too.
 */
export async function planElementRemove(changes: ChangeSet, config: ResolvedConfig, target: string): Promise<ElementRemoveResult> {
  const { id, file, element, tree } = await resolveTarget(changes.root, config, target);
  if (element.kind !== 'element') {
    throw new IssueError({ severity: 'error', code: 'remove-not-an-element', path: file, message: `${id} is a prop, not an element.`, hint: 'Remove the elements inside it, or edit the prop by hand.' });
  }
  const parent = allNodes(tree.roots).find((node) => node.children.includes(element));
  if (!parent?.layout) {
    const where = parent ? `"${parent.tag}", which is not a layout element` : 'the root of the component';
    throw new IssueError({
      severity: 'error',
      code: 'remove-parent-not-layout',
      path: file,
      message: `"${element.tag}" is in ${where}, so removing it would leave invalid code.`,
      hint: 'Elements can be removed only from layout elements (see "layoutComponents").',
    });
  }

  const sourceFile = tree.sourceFile;
  const text = sourceFile.getFullText();
  let updated = cut(text, removalRange(text, element.node.getStart(sourceFile), element.node.getEnd()));
  // Components used inside the removed element may now be unused in the file.
  const components = new Set(allNodes([element]).filter((node) => node.kind === 'element' && /^[A-Z]/.test(node.tag) && !node.tag.includes('.')).map((node) => node.tag));
  const imports: string[] = [];
  for (const name of components) {
    if (isStillUsed(updated, name)) continue;
    updated = removeImport(updated, name);
    imports.push(name);
  }

  const dropped = imports.length ? ` and the import of ${imports.join(', ')}` : '';
  changes.write(file, updated, { type: 'update', message: `removed <${element.tag}> from ${parent.path}${dropped}` });
  return { id, tag: element.tag, file };
}
