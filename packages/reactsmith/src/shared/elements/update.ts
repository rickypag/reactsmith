import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import { availableConstants } from '../constants/files.js';
import { findComponentSource } from '../imports/lookup.js';
import { IssueError } from '../issues.js';
import { createTextHolderClassifier } from '../layout/classify.js';
import { assertValidJsx } from '../types/check.js';
import { applyNames } from '../values/scope.js';
import { jsxText, parseValue, rootNames, type ValuePart } from '../values/template.js';
import { resolveTarget } from './ids.js';
import { isHtmlTag } from './kinds.js';
import { checkDeclaredProps, declaredProps, parseAttributes } from './props.js';

export interface ElementUpdateOptions {
  /** An element id or "file:line[:column]". */
  target: string;
  /** The new text of a text or interactive element; "{name}" uses a variable of the file. */
  text?: string;
  /** Props to set, as JSX attributes: each replaces the prop of the same name, or is added. */
  props?: string;
}

export interface ElementUpdateResult {
  /** The id of the updated element. */
  id: string;
  tag: string;
  /** Project-relative path of the edited file. */
  file: string;
}

function updateError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

function lineStartOf(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

/** Ranges of the text of an element: its words and {expressions}, not the elements next to them (such as icons). */
function textRanges(node: ts.JsxElement, sourceFile: ts.SourceFile): [number, number][] {
  return node.children.flatMap((child): [number, number][] => {
    if (ts.isJsxText(child)) {
      const raw = child.getFullText(sourceFile);
      const trimmed = raw.trim();
      if (!trimmed) return [];
      const start = child.getFullStart() + raw.indexOf(trimmed);
      return [[start, start + trimmed.length]];
    }
    // {/* comments */} stay.
    if (ts.isJsxExpression(child) && child.expression) return [[child.getStart(sourceFile), child.getEnd()]];
    return [];
  });
}

/** Replaces the text of a text element, keeping the elements inside it. */
function replaceText(text: string, sourceFile: ts.SourceFile, node: ts.JsxElement | ts.JsxSelfClosingElement, tag: string, content: string): string {
  if (ts.isJsxSelfClosingElement(node)) {
    if (!content) return text;
    const opening = text.slice(node.getStart(sourceFile), node.getEnd()).replace(/\s*\/>$/, '>');
    return `${text.slice(0, node.getStart(sourceFile))}${opening}${content}</${tag}>${text.slice(node.getEnd())}`;
  }

  const ranges = textRanges(node, sourceFile);
  if (ranges.length === 0) {
    if (!content) return text;
    // No text yet: after the other children, on its own line when the closing tag is on its own line.
    const closeStart = node.closingElement.getStart(sourceFile);
    const closeLine = lineStartOf(text, closeStart);
    if (text.slice(closeLine, closeStart).trim() !== '') return `${text.slice(0, closeStart)}${content}${text.slice(closeStart)}`;
    const indent = /^[ \t]*/.exec(text.slice(closeLine))![0];
    return `${text.slice(0, closeLine)}${indent}  ${content}\n${text.slice(closeLine)}`;
  }
  // The new text takes the place of the first piece of text; the other pieces go.
  let updated = text;
  for (const [index, [start, end]] of [...ranges.entries()].reverse()) {
    updated = `${updated.slice(0, start)}${index === 0 ? content : ''}${updated.slice(end)}`;
  }
  return updated;
}

/** Sets the attribute `name` of an element: replaces it when it is there, or adds it after the others. */
function setAttribute(text: string, sourceFile: ts.SourceFile, node: ts.JsxElement | ts.JsxSelfClosingElement, name: string, attribute: string): string {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const properties = opening.attributes.properties;
  const existing = properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name);
  if (existing) return `${text.slice(0, existing.getStart(sourceFile))}${attribute}${text.slice(existing.getEnd())}`;
  const after = properties.length ? properties[properties.length - 1]!.getEnd() : opening.tagName.getEnd();
  return `${text.slice(0, after)} ${attribute}${text.slice(after)}`;
}

/**
 * Plans updating an element's text and props. The text replaces the words and {expressions} of a text or interactive
 * element, keeping the elements inside it, such as an icon. Each prop replaces the one of the same name, or is added.
 * Both can use variables of the file: props, constants, imports. The props are checked like in element insert.
 */
export async function planElementUpdate(changes: ChangeSet, config: ResolvedConfig, options: ElementUpdateOptions): Promise<ElementUpdateResult> {
  if (options.text === undefined && options.props === undefined) {
    throw updateError('element-update-nothing', 'Nothing to update.', 'Pass --text, --props, or both.');
  }
  const textParts: ValuePart[] | undefined = options.text === undefined ? undefined : parseValue(options.text);

  const { id, file, element, tree } = await resolveTarget(changes.root, config, options.target);
  if (element.kind !== 'element') {
    throw updateError('update-not-an-element', `${id} is ${element.kind === 'list' ? 'a list' : 'a prop'}, not an element.`, element.kind === 'list' ? 'Pass the values through the props of the component it repeats.' : 'Update the elements inside it, or edit the prop by hand.', file);
  }
  const { tag } = element;
  const props = parseAttributes(options.props, tag);
  const sourceFile = tree.sourceFile;
  const node = element.node as ts.JsxElement | ts.JsxSelfClosingElement;
  const tagName = (ts.isJsxElement(node) ? node.openingElement : node).tagName;
  if (textParts && !createTextHolderClassifier(sourceFile, path.join(changes.root, file), changes.root, config)(tagName)) {
    throw updateError('element-text-not-allowed', `<${tag}> holds no text: only text elements (span, p…) and interactive ones (a, button…) do.`, 'Update a text element inside it, or insert one with "element insert".', file);
  }

  const start = node.getStart(sourceFile);
  let updated = sourceFile.getFullText();
  if (textParts) updated = replaceText(updated, sourceFile, node, tag, jsxText(textParts));
  for (const attribute of props.attributes) {
    // Each edit may move the element's end, not its start: find it again in the updated code.
    const reparsed = ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const same = findElementAt(reparsed, start);
    if (!same) throw new Error(`Lost the element ${id} while updating it`);
    updated = attribute.name ? setAttribute(updated, reparsed, same, attribute.name, attribute.text) : addSpread(updated, reparsed, same, attribute.text);
  }
  const final = findElementAt(ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), start)!;
  const jsx = updated.slice(start, final.getEnd());
  updated = applyNames(updated, file, tree.component, [...new Set([...rootNames(textParts ?? []), ...props.names])], {
    constants: await availableConstants(changes, config, file),
  });

  if (props.attributes.length) {
    const source = isHtmlTag(tag) ? undefined : await findComponentSource(changes, config, file, updated, tag);
    if (source?.kind === 'project') {
      const declared = declaredProps((await changes.read(`${source.folderRel}/${tag}.tsx`)) ?? '', tag);
      checkDeclaredProps(props, tag, { all: declared.all, required: [] });
    } else {
      assertValidJsx(changes.root, file, updated, jsx, tag);
    }
  }

  const what = [textParts && 'text', props.attributes.length && 'props'].filter(Boolean).join(' and ');
  changes.write(file, updated, { type: 'update', message: `updated the ${what} of <${tag}> ${element.path}` });
  return { id, tag, file };
}

/** Adds a spread to an element, unless it already has the same one. */
function addSpread(text: string, sourceFile: ts.SourceFile, node: ts.JsxElement | ts.JsxSelfClosingElement, spread: string): string {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const properties = opening.attributes.properties;
  if (properties.some((property) => property.getText(sourceFile) === spread)) return text;
  const after = properties.length ? properties[properties.length - 1]!.getEnd() : opening.tagName.getEnd();
  return `${text.slice(0, after)} ${spread}${text.slice(after)}`;
}

/** The JSX element starting at `offset`. */
function findElementAt(sourceFile: ts.SourceFile, offset: number): ts.JsxElement | ts.JsxSelfClosingElement | undefined {
  let found: ts.JsxElement | ts.JsxSelfClosingElement | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && node.getStart(sourceFile) === offset) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}
