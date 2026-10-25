import ts from 'typescript';
import type { ResolvedElement } from './ids.js';
import { allNodes, type ElementNode } from './tree.js';
import { IssueError } from '../issues.js';
import { componentNames } from '../values/scope.js';
import { isNamePath } from '../values/template.js';

/** Where an element goes, relative to the target: its last or first child, or a sibling before or after it. */
export const INSERT_POSITIONS = ['inside', 'first', 'before', 'after'] as const;
export type InsertPosition = (typeof INSERT_POSITIONS)[number];

/** A list: the variable to repeat over, the name of each item, and the key of each. */
export interface ListOptions {
  each: string;
  as: string;
  key: string;
}

function insertError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

function lineStartOf(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

function indentAt(text: string, offset: number): string {
  return /^[ \t]*/.exec(text.slice(lineStartOf(text, offset)))![0];
}

/** Whether `node` is alone on its lines: only whitespace before its start and after its end. */
function isAlone(text: string, start: number, end: number): boolean {
  const newline = text.indexOf('\n', end);
  return text.slice(lineStartOf(text, start), start).trim() === '' && text.slice(end, newline === -1 ? text.length : newline).trim() === '';
}

/** Checks a list: the list is a name or property path, the item a new name, the key a path on the item. */
export function checkList(list: ListOptions, sourceFile: ts.SourceFile, component: string, file: string): void {
  if (!isNamePath(list.each)) {
    throw insertError('list-each-invalid', `"${list.each}" is not a variable.`, 'Pass the list as a name or property path, e.g. --each links. Compute it first if needed, e.g. "const visible = links.filter(…)".', file);
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(list.as)) throw insertError('list-as-invalid', `"${list.as}" is not a valid name for the item.`, 'Use a name like --as link.', file);
  const names = componentNames(sourceFile, component);
  if (names && (names.inScope.has(list.as) || names.props.has(list.as))) {
    throw insertError('list-as-taken', `"${list.as}" is already a name in ${component}.`, 'Choose another name for the item with --as.', file);
  }
  if (!isNamePath(list.key) || list.key.split('.')[0] !== list.as) {
    throw insertError('list-key-invalid', `The key "${list.key}" is not a value of the item "${list.as}".`, `Use a unique value of each item, e.g. --key ${list.as}.id.`, file);
  }
}

/**
 * Checks that something can be inserted at `position` relative to the target: into it (inside, first),
 * it must hold elements (a layout or interactive element); next to it (before, after), its parent must.
 */
export function checkInsertionTarget({ id, file, element, tree }: ResolvedElement, position: InsertPosition): void {
  const parent = allNodes(tree.roots).find((node) => node.children.includes(element));
  const sibling = position === 'before' || position === 'after';
  const container = sibling ? parent : element;
  if (container?.layout) return;
  const what = sibling ? `the parent of ${id}` : id;
  const why = container ? `"${container.tag}" holds no elements` : `${element.tag} is the root of the component`;
  throw insertError('insert-target-not-layout', `Cannot insert ${sibling ? position : 'into'} ${id}: ${why}.`, `Elements go into layout elements (div, nav…) and interactive ones (a, button…); ${what} is neither.`, file);
}

/** Inserts `jsx` into `text` at `position` relative to `target`, keeping the indentation of the code around it. */
export function insertJsx(text: string, sourceFile: ts.SourceFile, target: ElementNode, position: InsertPosition, jsx: string): string {
  const node = target.node as ts.JsxElement | ts.JsxSelfClosingElement;
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const splice = (at: number, insert: string) => text.slice(0, at) + insert + text.slice(at);

  if (position === 'before' || position === 'after') {
    if (!isAlone(text, start, end)) return position === 'before' ? splice(start, jsx) : splice(end, jsx);
    const indent = indentAt(text, start);
    return position === 'before' ? splice(lineStartOf(text, start), `${indent}${jsx}\n`) : splice(end, `\n${indent}${jsx}`);
  }

  const indent = indentAt(text, start);
  if (ts.isJsxSelfClosingElement(node)) {
    // <div /> becomes <div>…</div>, with the new element on its own line.
    const opening = text.slice(start, end).replace(/\s*\/>$/, '>');
    // Right after "return", the element moves into "return ( … );", the way multi-line JSX is written.
    if (/\breturn\s*$/.test(text.slice(lineStartOf(text, start), start))) {
      const inner = `${indent}  `;
      const block = `(\n${inner}${opening}\n${inner}  ${jsx}\n${inner}</${target.tag}>\n${indent})`;
      return text.slice(0, start) + block + text.slice(end);
    }
    return text.slice(0, start) + `${opening}\n${indent}  ${jsx}\n${indent}</${target.tag}>` + text.slice(end);
  }

  const openEnd = node.openingElement.getEnd();
  const closeStart = node.closingElement.getStart(sourceFile);
  const children = target.children.filter((child) => child.kind !== 'slot');
  const multiline = text.slice(start, closeStart).includes('\n');
  if (!multiline) return position === 'first' ? splice(openEnd, jsx) : splice(closeStart, jsx);

  const childIndent = children[0] ? indentAt(text, children[0].node.getStart(sourceFile)) : `${indent}  `;
  if (position === 'first') return splice(openEnd, `\n${childIndent}${jsx}`);
  // Before the closing tag: on its own line when the closing tag starts its line.
  const closeLine = lineStartOf(text, closeStart);
  return text.slice(closeLine, closeStart).trim() === '' ? splice(closeLine, `${childIndent}${jsx}\n`) : splice(closeStart, `\n${childIndent}${jsx}\n${indent}`);
}
