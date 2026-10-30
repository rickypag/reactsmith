import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { cut, removalRange } from '../code/remove.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';
import { createContainerClassifier } from '../layout/classify.js';
import { elementId, resolveTarget } from './ids.js';
import { checkInsertionTarget, insertJsx, type InsertPosition } from './position.js';
import { tableNestingProblem } from './table.js';
import { allNodes, buildElementTree, type ElementNode, type ElementTree } from './tree.js';

export interface ElementMoveOptions {
  /** The element to move: an id or "file:line[:column]". */
  target: string;
  /** With it, the siblings from the target through this one move together, in the order of the code. */
  through?: string;
  /** Where it goes: an element of the same file. */
  into: string;
  position: InsertPosition;
}

export interface ElementMoveResult {
  file: string;
  /** The id of the moved element (the first one, when several move). */
  id: string;
}

function moveError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

const parentOf = (tree: ElementTree, node: ElementNode) => allNodes(tree.roots).find((candidate) => candidate.children.includes(node));

/** Where moved code starts its lines: the indentation of its first line, removed from every line. */
function dedent(text: string, start: number, code: string): string {
  const indent = /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', start - 1) + 1))![0];
  return code
    .split('\n')
    .map((line, index) => (index > 0 && line.startsWith(indent) ? line.slice(indent.length) : line))
    .join('\n');
}

const PLACEHOLDER = '<ReactSmithMovePlaceholder />';

/**
 * Plans moving an element, with everything inside it, to another place of the same file: into an element (inside,
 * first) or next to one (before, after), as "element insert" places a new one. With `through`, the siblings from the
 * target through that one move together. The code moves as it is: names, styles, props, text and hand-written logic stay.
 * Refused: the root, a prop holding JSX, a branch of a condition (move the condition), another file, a place inside
 * what moves, and a move that changes nothing.
 */
export async function planElementMove(changes: ChangeSet, config: ResolvedConfig, options: ElementMoveOptions): Promise<ElementMoveResult> {
  const { id, file, element, tree } = await resolveTarget(changes.root, config, options.target);
  const sourceFile = tree.sourceFile;
  const text = sourceFile.getFullText();
  if (element.kind === 'slot') throw moveError('move-not-an-element', `${id} is a prop, not an element.`, 'Move the elements inside it instead.', file);
  const parent = parentOf(tree, element);
  if (!parent) throw moveError('move-root', `${id} is the root of ${tree.component}.`, 'Move the elements inside it instead: the root carries the class a parent passes to the component.', file);
  if (parent.kind === 'condition') {
    throw moveError('move-branch', `${id} is a branch of the condition ${elementId('', parent, tree)}.`, `Move the whole condition, or take the element out of it first: element remove "${elementId('', parent, tree)}" --keep-children.`, file);
  }

  // What moves: the target, or the siblings from it through another one.
  let nodes = [element];
  if (options.through !== undefined) {
    const last = await resolveTarget(changes.root, config, options.through);
    const siblings = parent.children.filter((node) => node.kind !== 'slot');
    const lastStart = last.element.node.getStart(last.tree.sourceFile);
    const index = siblings.findIndex((node) => node.node.getStart(sourceFile) === lastStart);
    if (last.file !== file || index === -1) {
      throw moveError('move-not-siblings', `${last.id} is not next to ${id}: only siblings, elements of the same parent, move together.`, `Choose an element of ${elementId('', parent, tree)} for --through.`, file);
    }
    const from = siblings.indexOf(element);
    nodes = siblings.slice(Math.min(from, index), Math.max(from, index) + 1);
  }
  const start = nodes[0]!.node.getStart(sourceFile);
  const end = nodes[nodes.length - 1]!.node.getEnd();

  // Where it goes: an element of the same file; next to a branch of a condition is next to the condition.
  const destination = await resolveTarget(changes.root, config, options.into);
  if (destination.file !== file) {
    throw moveError('move-other-file', `${destination.id} is in ${destination.file}, not in ${file}: elements move inside their file.`, 'To move an element to another component, remove it and insert it there, or make it a component of its own and insert that.', file);
  }
  // The destination comes from its own reading of the file: the same element in this tree, by where it starts.
  const destinationStart = destination.element.node.getStart(destination.tree.sourceFile);
  const landing = allNodes(tree.roots).find((node) => node.node.getStart(sourceFile) === destinationStart && node.tag === destination.element.tag) ?? destination.element;
  const sibling = options.position === 'before' || options.position === 'after';
  const destinationParent = parentOf(tree, landing);
  const target = sibling && destinationParent?.kind === 'condition' ? destinationParent : landing;
  if (!sibling && target.kind === 'condition') {
    throw moveError('move-into-condition', `${destination.id} is a condition.`, 'Move it next to the condition, or into the element it shows.', file);
  }
  const targetStart = target.node.getStart(sourceFile);
  if (targetStart >= start && targetStart < end) {
    throw moveError('move-into-itself', `${destination.id} is ${nodes.includes(target) ? 'what moves' : 'inside what moves'}.`, 'Choose a place outside the elements that move.', file);
  }
  checkInsertionTarget({ ...destination, element: target, tree }, options.position);

  // Already there: right after or before the destination, or its last or first children.
  const siblings = parent.children.filter((node) => node.kind !== 'slot');
  const [first, last] = [siblings.indexOf(nodes[0]!), siblings.indexOf(nodes[nodes.length - 1]!)];
  const already =
    (options.position === 'after' && siblings[first - 1] === target) ||
    (options.position === 'before' && siblings[last + 1] === target) ||
    (options.position === 'inside' && parent === target && last === siblings.length - 1) ||
    (options.position === 'first' && parent === target && first === 0);
  if (already) throw moveError('move-nothing', `${id} is already there.`, 'Choose another place.', file);

  // The container must accept what moves: table elements go where HTML allows them.
  const container = sibling ? parentOf(tree, target) : target;
  for (const node of nodes) {
    const problem = container && tableNestingProblem(container.tag, node.kind === 'list' ? (node.component ?? node.tag) : node.tag);
    if (problem) throw moveError('table-content-invalid', problem.message, problem.hint, file);
  }

  // The destination is marked in the original code, the moved code is cut, and the mark takes its place.
  const marked = insertJsx(text, sourceFile, target, options.position, PLACEHOLDER);
  const offset = marked.indexOf(PLACEHOLDER);
  // A mark before the moved code pushes it further by what the marking added; one after it leaves it in place.
  const shift = offset < start ? marked.length - text.length : 0;
  const [cutStart, cutEnd] = removalRange(marked, start + shift, end + shift);
  let updated = cut(marked, [cutStart, cutEnd]);
  const at = updated.indexOf(PLACEHOLDER);
  const indent = /^[ \t]*/.exec(updated.slice(updated.lastIndexOf('\n', at - 1) + 1))![0];
  const lineIndent = updated.slice(updated.lastIndexOf('\n', at - 1) + 1, at).trim() === '' ? indent : `${indent}  `;
  const code = dedent(text, start, text.slice(start, end))
    .split('\n')
    .map((line, index) => (index > 0 && line ? `${lineIndent}${line}` : line))
    .join('\n');
  updated = `${updated.slice(0, at)}${code}${updated.slice(at + PLACEHOLDER.length)}`;
  if (updated === text) throw moveError('move-nothing', `${id} is already there.`, 'Choose another place.', file);

  // The id of what moved, found where its code now starts.
  const newSource = ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const newTree = buildElementTree(newSource, tree.component, createContainerClassifier(newSource, path.join(changes.root, file), changes.root, config));
  const moved = newTree && allNodes(newTree.roots).find((node) => node.node.getStart(newSource) === at);
  const srcRel = file.slice(config.srcDir.length + 1);
  const what = nodes.length === 1 ? elementId('', element, tree) : `${nodes.length} elements from ${elementId('', element, tree)}`;
  const where = options.position === 'inside' ? `into ${destination.id.slice(destination.id.indexOf('#'))}` : options.position === 'first' ? `to the start of ${destination.id.slice(destination.id.indexOf('#'))}` : `${options.position} ${elementId('', target, tree)}`;
  changes.write(file, updated, { type: 'update', message: `moved ${what} ${where}` });
  return { file, id: moved && newTree ? elementId(srcRel, moved, newTree) : '' };
}
