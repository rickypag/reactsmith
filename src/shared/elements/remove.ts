import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { cut, isStillUsed, removalRange, removeImport } from '../code/remove.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';
import { createTextHolderClassifier } from '../layout/classify.js';
import { planUnusedStyleRemoval } from '../styles/remove.js';
import { elementId, resolveTarget, type ResolvedElement } from './ids.js';
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
 * A condition goes with what it shows, or alone with `keepChildren`; a branch of one leaves the other branch.
 */
export async function planElementRemove(changes: ChangeSet, config: ResolvedConfig, target: string, keepChildren = false): Promise<ElementRemoveResult> {
  const { id, file, element, tree } = await resolveTarget(changes.root, config, target);
  if (element.kind === 'slot') {
    throw new IssueError({ severity: 'error', code: 'remove-not-an-element', path: file, message: `${id} is a prop, not an element.`, hint: 'Remove the elements inside it, or edit the prop by hand.' });
  }
  if (keepChildren && element.kind === 'list') {
    throw removeError('remove-list-keep-children', `${id} is a list: it has no children to keep.`, 'Remove the list without --keep-children.', file);
  }
  if (keepChildren && !allNodes(tree.roots).some((node) => node.children.includes(element))) return planRootUnwrap(changes, config, { id, file, element, tree });
  const direct = allNodes(tree.roots).find((node) => node.children.includes(element));
  // A branch of a condition: the condition stays with its other branch, or goes with its only one.
  const condition = direct?.kind === 'condition' ? direct : undefined;
  if (condition) return planBranchRemove(changes, config, { id, file, element, tree }, condition, keepChildren);
  if (element.kind === 'condition') return planConditionRemove(changes, config, { id, file, element, tree }, keepChildren);
  const parent = direct;
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
  const what = element.kind === 'list' ? `the list ${element.tag} of <${element.component ?? '?'}>` : `<${element.tag}>`;
  const kept = keepChildren ? ', keeping its content' : '';
  await writeRemoval(changes, config, file, updated, keepChildren ? [element] : allNodes([element]), `removed ${what} from ${elementId('', parent, tree)}`, kept);
  return { id, tag: element.tag, file };
}

/**
 * Plans removing the root of a component, keeping its content: its only element becomes the root (a wrapper put
 * around it first, then the old root unwrapped, replaces the root). Several elements, text, a list, a condition or
 * {children} would leave no single element as the root.
 */
async function planRootUnwrap(changes: ChangeSet, config: ResolvedConfig, { id, file, element, tree }: ResolvedElement): Promise<ElementRemoveResult> {
  const node = element.node;
  const only = element.children.length === 1 && element.children[0]!.kind === 'element' ? element.children[0]! : undefined;
  if (!ts.isJsxElement(node) || !only || holdsTextDirectly(element)) {
    throw removeError(
      'remove-root-keep-children',
      `${id} is the root of ${tree.component}, and holds no single element to take its place.`,
      'Wrap its content in one element first (element insert div --around <first> --through <last>), then unwrap the root, or edit it by hand.',
      file,
    );
  }
  const { sourceFile } = tree;
  const text = sourceFile.getFullText();
  const updated = `${text.slice(0, node.getStart(sourceFile))}${contentOf(text, node, sourceFile)}${text.slice(node.getEnd())}`;
  await writeRemoval(changes, config, file, updated, [element], `removed the root <${element.tag}> of ${tree.component}`, `, keeping ${elementId('', only, tree)} as the root`, true);
  return { id, tag: element.tag, file };
}

/**
 * Writes a removal: imports of components and styles that only the removed nodes used go too, when nothing
 * else in the file uses them. The suffix ends the message, after what was dropped.
 */
async function writeRemoval(changes: ChangeSet, config: ResolvedConfig, file: string, text: string, removed: ElementNode[], message: string, suffix = '', withRoot = false): Promise<void> {
  let updated = text;
  const components = new Set(
    removed
      .map((node) => (node.kind === 'list' ? node.component : node.kind === 'element' ? node.tag : undefined))
      .filter((tag): tag is string => tag !== undefined && /^[A-Z]/.test(tag) && !tag.includes('.')),
  );
  const imports: string[] = [];
  for (const name of components) {
    if (isStillUsed(updated, name)) continue;
    updated = removeImport(updated, name);
    imports.push(name);
  }
  const names = removed.flatMap((node) => (node.name ? [node.name] : []));
  const styles = await planUnusedStyleRemoval(changes, config, file, updated, names, withRoot);
  const dropped = [imports.length && `the import of ${imports.join(', ')}`, styles.length && `the style${styles.length > 1 ? 's' : ''} ${styles.map((name) => `"${name}"`).join(', ')}`].filter(Boolean);
  changes.write(file, updated, { type: 'update', message: `${message}${dropped.length ? ` and ${dropped.join(' and ')}` : ''}${suffix}` });
}

/** The code a branch shows, as a child of JSX: an element as written, a list in braces. */
function branchCode(branch: ElementNode, sourceFile: ts.SourceFile): string {
  const code = branch.node.getText(sourceFile);
  return branch.kind === 'list' ? `{${code}}` : code;
}

/** Whether the element a condition is in holds elements, so the code stays valid without it. */
function assertRemovable(tree: ResolvedElement['tree'], condition: ElementNode, id: string, file: string): ElementNode {
  const parent = allNodes(tree.roots).find((node) => node.children.includes(condition));
  if (!parent?.layout) {
    const where = parent ? `"${parent.tag}", which holds no elements` : 'the root of the component';
    throw removeError('remove-parent-not-layout', `${id} is in ${where}, so removing it would leave invalid code.`, 'Elements can be removed only from layout elements (div, nav…) and interactive ones (a, button…).', file);
  }
  return parent;
}

/**
 * Plans removing a condition, `{open && <nav />}`, with what it shows; with `keepChildren`, only the condition:
 * its element (or list) stays, always shown. A condition with two branches, or a fallback, has nothing single to keep.
 */
async function planConditionRemove(changes: ChangeSet, config: ResolvedConfig, { id, file, element, tree }: ResolvedElement, keepChildren: boolean): Promise<ElementRemoveResult> {
  const parent = assertRemovable(tree, element, id, file);
  const { sourceFile } = tree;
  const text = sourceFile.getFullText();
  const node = element.node;
  const { operator, branches } = element.condition!;
  if (!keepChildren) {
    await writeRemoval(changes, config, file, cut(text, removalRange(text, node.getStart(sourceFile), node.getEnd())), allNodes([element]), `removed the condition ${element.tag} from ${elementId('', parent, tree)}`);
    return { id, tag: element.tag, file };
  }
  if (operator === '||' || operator === '??') {
    throw removeError('remove-fallback-keep-children', `${id} is a fallback: keeping only its element would drop the value it shows.`, 'Remove the whole condition, or change it by hand.', file);
  }
  if (branches.length !== 1) {
    throw removeError('remove-condition-two-branches', `${id} shows an element in both branches: there is no single one to keep.`, 'Remove one branch first, then the condition with --keep-children.', file);
  }
  const updated = `${text.slice(0, node.getStart(sourceFile))}${branchCode(element.children[0]!, sourceFile)}${text.slice(node.getEnd())}`;
  await writeRemoval(changes, config, file, updated, [], `removed the condition ${element.tag} from ${elementId('', parent, tree)}, keeping what it shows`);
  return { id, tag: element.tag, file };
}

/**
 * Plans removing a branch of a condition: `open ? <A /> : <B />` keeps the other one (`!open && <B />`);
 * a condition with only this branch goes with it, since it would show nothing.
 */
async function planBranchRemove(changes: ChangeSet, config: ResolvedConfig, { id, file, element, tree }: ResolvedElement, condition: ElementNode, keepChildren: boolean): Promise<ElementRemoveResult> {
  if (keepChildren) {
    throw removeError('remove-branch-keep-children', `${id} is a branch of the condition ${elementId('', condition, tree)}: its content would lose the condition.`, 'Remove the condition with --keep-children instead, or the branch with its content.', file);
  }
  const { operator, test, branches } = condition.condition!;
  if (operator === '||' || operator === '??') {
    throw removeError('remove-fallback-branch', `${id} is what the fallback ${elementId('', condition, tree)} shows when ${test} is missing.`, 'Remove the whole condition instead, or change it by hand.', file);
  }
  const parent = assertRemovable(tree, condition, id, file);
  const { sourceFile } = tree;
  const text = sourceFile.getFullText();
  const what = element.kind === 'list' ? `the list ${element.tag}` : `<${element.tag}>`;
  if (branches.length === 1) {
    const node = condition.node;
    await writeRemoval(changes, config, file, cut(text, removalRange(text, node.getStart(sourceFile), node.getEnd())), allNodes([condition]), `removed ${what} and its condition ${condition.tag} from ${elementId('', parent, tree)}`);
    return { id, tag: element.tag, file };
  }
  // The other branch stays, shown when the test says so.
  const other = condition.children.find((child) => child !== element)!;
  const removedThen = branches[0]!.node === element.node;
  const kept = other.node.getText(sourceFile);
  const keptTest = removedThen ? (test.startsWith('!') ? test.slice(1) : `!${test}`) : test;
  const expression = (condition.node as ts.JsxExpression).expression!;
  const updated = `${text.slice(0, expression.getStart(sourceFile))}${keptTest} && ${kept}${text.slice(expression.getEnd())}`;
  await writeRemoval(changes, config, file, updated, allNodes([element]), `removed ${what} from the condition ${condition.tag}, which now shows only its other branch`);
  return { id, tag: element.tag, file };
}
