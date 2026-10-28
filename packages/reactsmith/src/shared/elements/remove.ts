import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { cut, isStillUsed, removalRange, removeImport } from '../code/remove.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';
import { createTextHolderClassifier } from '../layout/classify.js';
import { planUnusedStyleRemoval } from '../styles/remove.js';
import { resolveTarget } from './ids.js';
import { tableNestingProblem } from './table.js';
import { allNodes, type ElementNode } from './tree.js';

export interface ElementRemoveResult {
  /** The removed element's id. */
  id: string;
  tag: string;
  /** Project-relative path of the edited file. */
  file: string;
}

function removeError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** The content of an element, to put in its place: re-indented to where the element was, without the blank edges. */
function contentOf(text: string, node: ts.JsxElement, sourceFile: ts.SourceFile): string {
  const inner = text.slice(node.openingElement.getEnd(), node.closingElement.getStart(sourceFile));
  if (!inner.includes('\n')) return inner.trim();
  const lines = inner.split('\n');
  while (lines.length && lines[0]!.trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  const common = Math.min(...lines.filter((line) => line.trim()).map((line) => /^[ \t]*/.exec(line)![0].length));
  const start = node.getStart(sourceFile);
  const indent = text.slice(text.lastIndexOf('\n', start - 1) + 1, start);
  return lines.map((line, index) => (line.trim() === '' ? '' : `${index === 0 ? '' : indent}${line.slice(common)}`)).join('\n');
}

/** Whether an element holds text directly: words or values, not elements, lists or {children}. */
function holdsTextDirectly(element: ElementNode): boolean {
  if (!ts.isJsxElement(element.node)) return false;
  return element.node.children.some((child) => {
    if (ts.isJsxText(child)) return !child.containsOnlyTriviaWhiteSpaces;
    if (!ts.isJsxExpression(child) || !child.expression) return false;
    if (ts.isIdentifier(child.expression) && child.expression.text === 'children') return false;
    return !element.children.some((node) => node.node === child);
  });
}

/**
 * Plans removing an element, given by id or "file:line[:column]", with everything inside it: an HTML element,
 * a component, or a list. Its parent must hold elements (a layout or interactive element), so the code stays valid.
 * Imports of components that are no longer used in the file are removed too; their files are kept.
 * The styles of the removed elements go too, when nothing else in the file uses them.
 * With `keepChildren`, only the element goes: its content takes its place, if the parent can hold it.
 */
export async function planElementRemove(changes: ChangeSet, config: ResolvedConfig, target: string, keepChildren = false): Promise<ElementRemoveResult> {
  const { id, file, element, tree } = await resolveTarget(changes.root, config, target);
  if (element.kind === 'slot') {
    throw new IssueError({ severity: 'error', code: 'remove-not-an-element', path: file, message: `${id} is a prop, not an element.`, hint: 'Remove the elements inside it, or edit the prop by hand.' });
  }
  if (keepChildren && element.kind === 'list') {
    throw removeError('remove-list-keep-children', `${id} is a list: it has no children to keep.`, 'Remove the list without --keep-children.', file);
  }
  if (keepChildren && !allNodes(tree.roots).some((node) => node.children.includes(element))) {
    throw removeError('remove-root-keep-children', `${id} is the root of ${tree.component}.`, 'Its content would have no single root: remove the elements around it instead, or edit it by hand.', file);
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
  const node = element.node;
  let updated: string;
  if (keepChildren && ts.isJsxElement(node) && contentOf(text, node, sourceFile) !== '') {
    // Its content must fit where it goes: text needs a text holder, table parts their table element.
    const parentNode = parent.node as ts.JsxElement | ts.JsxSelfClosingElement;
    const isTextHolder = createTextHolderClassifier(sourceFile, path.join(changes.root, file), changes.root, config);
    if (holdsTextDirectly(element) && !isTextHolder((ts.isJsxElement(parentNode) ? parentNode.openingElement : parentNode).tagName)) {
      throw removeError('remove-children-not-allowed', `<${element.tag}> holds text, and its parent <${parent.tag}> holds none.`, 'Move the text into a text element first, or remove the element with its content.', file);
    }
    for (const child of element.children.filter((candidate) => candidate.kind !== 'slot')) {
      const problem = tableNestingProblem(parent.tag, child.kind === 'list' ? (child.component ?? child.tag) : child.tag);
      if (problem) throw removeError('table-content-invalid', problem.message, problem.hint, file);
    }
    updated = `${text.slice(0, node.getStart(sourceFile))}${contentOf(text, node, sourceFile)}${text.slice(node.getEnd())}`;
  } else {
    updated = cut(text, removalRange(text, node.getStart(sourceFile), node.getEnd()));
  }
  // Components used inside the removed element may now be unused in the file: only the element's own with --keep-children.
  const components = new Set(
    (keepChildren ? [element] : allNodes([element]))
      .map((removed) => (removed.kind === 'list' ? removed.component : removed.kind === 'element' ? removed.tag : undefined))
      .filter((tag): tag is string => tag !== undefined && /^[A-Z]/.test(tag) && !tag.includes('.')),
  );
  const imports: string[] = [];
  for (const name of components) {
    if (isStillUsed(updated, name)) continue;
    updated = removeImport(updated, name);
    imports.push(name);
  }
  // The styles of what is removed go when nothing else in the file uses them: the element's own, and those inside it.
  const names = (keepChildren ? [element] : allNodes([element])).flatMap((removed) => (removed.name ? [removed.name] : []));
  const styles = await planUnusedStyleRemoval(changes, config, file, updated, names);

  const dropped = [imports.length && `the import of ${imports.join(', ')}`, styles.length && `the style${styles.length > 1 ? 's' : ''} ${styles.map((name) => `"${name}"`).join(', ')}`].filter(Boolean);
  const what = element.kind === 'list' ? `the list ${element.tag} of <${element.component ?? '?'}>` : `<${element.tag}>`;
  const kept = keepChildren ? ', keeping its content' : '';
  changes.write(file, updated, { type: 'update', message: `removed ${what} from ${parent.path}${kept}${dropped.length ? ` and ${dropped.join(' and ')}` : ''}` });
  return { id, tag: element.tag, file };
}
