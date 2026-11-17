import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import { availableConstants } from '../constants/files.js';
import { findComponentSource } from '../imports/lookup.js';
import { importComponentValues } from '../imports/values.js';
import { IssueError, type Issue } from '../issues.js';
import { createTextHolderClassifier } from '../layout/classify.js';
import { assertInlineStyleLimit } from '../structure/inline-styles.js';
import { planComponentStyling } from '../styles/styleable.js';
import { assertValidJsx } from '../types/check.js';
import { jsxText, parseValue, rootNames, type ValuePart } from '../values/template.js';
import { isImported, isReferenced, isStillUsed, removeImport } from '../code/remove.js';
import { applyNames, undestructureProp } from '../values/scope.js';
import { TRANSLATOR_NAME } from '../config/defaults.js';
import { keyPath, messageJsx, requireMessage, requirePropMessages, translatorOf, withTranslator } from '../i18n/messages.js';
import { propTargets, propTypes } from '../values/placeholders.js';
import { elementId, resolveTarget } from './ids.js';
import { allNodes } from './tree.js';
import { isHtmlTag } from './kinds.js';
import { checkDeclaredProps, declaredProps, parseAttributes } from './props.js';

export interface ElementUpdateOptions {
  /** An element id or "file:line[:column]". */
  target: string;
  /** The new text of a text or interactive element; "{name}" uses a variable of the file. */
  text?: string;
  /** Instead of a text, a translated message of the component's group: "register" shows {t('register')}. */
  message?: string;
  /** Props to set, as JSX attributes: each replaces the prop of the same name, or is added. */
  props?: string;
  /** Props to remove, by name: "label elevated". "children" empties the element. */
  removeProps?: string;
}

export interface ElementUpdateResult {
  /** The id of the updated element. */
  id: string;
  tag: string;
  /** Project-relative path of the edited file. */
  file: string;
  /** Variables the old text read that nothing uses now and that only a hand edit can remove. */
  warnings: Issue[];
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

/** Whether an expression is a value --text or --message writes: a name, a property path ({user.name}), a string, or a message ({t('key')}). */
function isTextValue(expression: ts.Expression): boolean {
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.arguments.length === 1 && ts.isStringLiteralLike(expression.arguments[0]!)) return true;
  if (ts.isIdentifier(expression) || ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) || ts.isNumericLiteral(expression)) return true;
  return ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name) && isTextValue(expression.expression) && !ts.isStringLiteral(expression.expression);
}

/** The first variable of a value: "user" for {user.name}, undefined for a string. */
function rootName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  return ts.isPropertyAccessExpression(expression) ? rootName(expression.expression) : undefined;
}

/**
 * Checks that the text of an element can be replaced: it holds only text and the values --text writes, and, in an
 * interactive element, other elements (such as an icon), which stay. Anything else was written by hand, so the command
 * refuses rather than delete it. Returns the variables the current text reads.
 */
function replaceableText(node: ts.JsxElement, sourceFile: ts.SourceFile, tag: string, interactive: boolean, file: string): string[] {
  const names: string[] = [];
  for (const child of node.children) {
    if (ts.isJsxText(child)) continue;
    if (ts.isJsxExpression(child)) {
      // {/* comments */} stay.
      if (!child.expression) continue;
      if (isTextValue(child.expression)) {
        const name = rootName(child.expression);
        if (name) names.push(name);
        continue;
      }
    } else if (interactive && (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child))) {
      continue;
    }
    const code = child.getText(sourceFile).replace(/\s+/g, ' ');
    const line = sourceFile.getLineAndCharacterOfPosition(child.getStart(sourceFile)).line + 1;
    throw updateError(
      'element-text-hand-written',
      `<${tag}> holds ${code.length > 40 ? `${code.slice(0, 40)}…` : code} (line ${line}), which was written by hand.`,
      interactive ? 'Change its text by hand, or remove that code first.' : 'Change its text by hand. Text elements hold only text: icons and other elements go next to them, in their container.',
      file,
    );
  }
  return names;
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
  if (options.text === undefined && options.message === undefined && options.props === undefined && options.removeProps === undefined) {
    throw updateError('element-update-nothing', 'Nothing to update.', 'Pass --text, --message, --props or --remove-props.');
  }
  if (options.text !== undefined && options.message !== undefined) throw updateError('options-conflict', '--text and --message cannot be used together.', 'Pass the text one way: --message shows a translated text, --text a literal one.');
  const removed = [...new Set((options.removeProps ?? '').split(/[\s,]+/).filter(Boolean))];
  const textParts: ValuePart[] | undefined = options.text === undefined ? undefined : parseValue(options.text);

  const { id, file, element, tree } = await resolveTarget(changes.root, config, options.target);
  // A message must have its text in the default language first; the translator's name comes from the component.
  if (options.message !== undefined) await requireMessage(changes, config, tree.component, options.message, file);
  const content =
    options.message !== undefined
      ? messageJsx(translatorOf(tree.sourceFile, tree.component, config.i18n!)?.name ?? TRANSLATOR_NAME, keyPath(options.message).join('.'))
      : textParts
        ? jsxText(textParts)
        : undefined;
  if (element.kind !== 'element') {
    const kind = element.kind === 'list' ? 'a list' : element.kind === 'condition' ? 'a condition' : 'a prop';
    const hint = element.kind === 'list' ? 'Pass the values through the props of the component it repeats.' : element.kind === 'condition' ? 'Update the elements it shows, e.g. its branch by name.' : 'Update the elements inside it, or edit the prop by hand.';
    throw updateError('update-not-an-element', `${id} is ${kind}, not an element.`, hint, file);
  }
  const { tag } = element;
  const props = parseAttributes(options.props, tag, { messages: config.i18n !== undefined });
  await requirePropMessages(changes, config, tree.sourceFile, tree.component, props.messages, file);
  const both = removed.find((name) => props.attributes.some((attribute) => attribute.name === name));
  if (both) throw updateError('options-conflict', `"${both}" is both set and removed.`, 'Pass it with --props or with --remove-props, not both.', file);
  if (removed.includes('children') && content !== undefined) throw updateError('options-conflict', '--text and removing children cannot be used together.', 'Removing children empties the element, text included.', file);
  const sourceFile = tree.sourceFile;
  const node = element.node as ts.JsxElement | ts.JsxSelfClosingElement;
  const tagName = (ts.isJsxElement(node) ? node.openingElement : node).tagName;
  if (content !== undefined && !createTextHolderClassifier(sourceFile, path.join(changes.root, file), changes.root, config)(tagName)) {
    throw updateError('element-text-not-allowed', `<${tag}> holds no text: only text elements (span, p…) and interactive ones (a, button…) do.`, 'Update a text element inside it, or insert one with "element insert".', file);
  }
  // An element that holds text and elements: a link, a button or a table cell.
  const interactive = element.layout;
  // The variables the old text reads: those it alone used go with it.
  const oldNames: string[] = content !== undefined && ts.isJsxElement(node) ? replaceableText(node, sourceFile, tag, interactive, file) : [];
  // So do those the old values of replaced or removed props read: `label={REGISTER_LABEL.en}` → REGISTER_LABEL.
  const changedProps = new Set([...props.attributes.flatMap((attribute) => (attribute.name ? [attribute.name] : [])), ...removed]);
  for (const property of (ts.isJsxElement(node) ? node.openingElement : node).attributes.properties) {
    if (ts.isJsxAttribute(property) && changedProps.has(property.name.getText(sourceFile)) && property.initializer) oldNames.push(...readNames(property.initializer));
  }

  const start = node.getStart(sourceFile);
  let updated = sourceFile.getFullText();
  if (content !== undefined) updated = replaceText(updated, sourceFile, node, tag, content);
  for (const attribute of props.attributes) {
    // Each edit may move the element's end, not its start: find it again in the updated code.
    const reparsed = ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const same = findElementAt(reparsed, start);
    if (!same) throw new Error(`Lost the element ${id} while updating it`);
    updated = attribute.name ? setAttribute(updated, reparsed, same, attribute.name, attribute.text) : addSpread(updated, reparsed, same, attribute.text);
  }
  // Removing props, the opposite of setting them: "children" empties the element.
  const droppedComponents = new Set<string>();
  for (const name of removed) {
    const reparsed = ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const same = findElementAt(reparsed, start)!;
    if (name === 'children') {
      if (!ts.isJsxElement(same) || same.children.every((child) => ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces)) {
        throw updateError('prop-missing', `<${tag}> has no children.`, 'There is nothing inside it to remove.', file);
      }
      for (const child of allNodes(element.children)) {
        const component = child.kind === 'list' ? child.component : child.kind === 'element' ? child.tag : undefined;
        if (component && /^[A-Z]/.test(component) && !component.includes('.')) droppedComponents.add(component);
      }
      const opening = updated.slice(same.openingElement.getStart(reparsed), same.openingElement.getEnd()).replace(/\s*>$/, ' />');
      updated = `${updated.slice(0, same.getStart(reparsed))}${opening}${updated.slice(same.getEnd())}`;
      continue;
    }
    const opening = ts.isJsxElement(same) ? same.openingElement : same;
    const attribute = opening.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(reparsed) === name);
    if (!attribute) throw updateError('prop-missing', `<${tag}> has no prop "${name}".`, 'Check the name: only props written on the element can be removed.', file);
    const from = updated.slice(0, attribute.getStart(reparsed)).replace(/\s+$/, '').length;
    updated = `${updated.slice(0, from)}${updated.slice(attribute.getEnd())}`;
  }

  const final = findElementAt(ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), start)!;
  const jsx = updated.slice(start, final.getEnd());
  // Imports go after the element is read: removing a line above it moves it.
  for (const component of droppedComponents) {
    if (!isStillUsed(updated, component)) updated = removeImport(updated, component);
  }
  assertInlineStyleLimit(config, jsx, tag);
  const constants = await availableConstants(changes, config, file);
  updated = await importComponentValues(changes, config, file, updated, tree.component, props.names, constants);
  // Variables given to a component of the project get a placeholder when missing and of a basic type.
  const valueSource = props.attributes.length && !isHtmlTag(tag) ? await findComponentSource(changes, config, file, updated, tag) : undefined;
  const targets = valueSource?.kind === 'project' ? propTargets(props, tag, propTypes((await changes.read(`${valueSource.folderRel}/${tag}.tsx`)) ?? '', tag)) : undefined;
  const warnings: Issue[] = [];
  updated = applyNames(updated, file, tree.component, [...new Set([...rootNames(textParts ?? []), ...props.names])], { constants, propTargets: targets, warnings });
  if (options.message !== undefined || props.messages.length) updated = withTranslator(updated, file, tree.component, config.i18n!).text;
  for (const name of new Set(oldNames)) {
    if (isReferenced(updated, name)) continue;
    if (isImported(updated, name)) {
      updated = removeImport(updated, name);
      continue;
    }
    const undestructured = undestructureProp(updated, file, tree.component, name);
    if (undestructured !== undefined) {
      updated = undestructured;
      continue;
    }
    warnings.push({
      severity: 'warning',
      code: 'variable-unused',
      path: file,
      message: `"${name}" is no longer used by ${tree.component}.`,
      hint: 'Remove it from the component by hand, or use it again: TypeScript reports unused variables.',
    });
  }

  if (props.attributes.length || removed.length) {
    const source = isHtmlTag(tag) ? undefined : await findComponentSource(changes, config, file, updated, tag);
    if (source?.kind === 'project') {
      const classProp = await planComponentStyling(changes, config, source.folderRel!, tag, props.attributes.map((attribute) => attribute.name), false);
      const declared = declaredProps((await changes.read(`${source.folderRel}/${tag}.tsx`)) ?? '', tag);
      checkDeclaredProps({ ...props, attributes: props.attributes.filter((attribute) => attribute.name !== classProp) }, tag, { all: declared.all, required: [] });
      // A removed prop the component requires would leave a usage that doesn't compile.
      const opening = ts.isJsxElement(final) ? final.openingElement : final;
      const spread = opening.attributes.properties.some((property) => ts.isJsxSpreadAttribute(property));
      const required = removed.find((name) => declared.required.includes(name));
      if (required && !spread) throw updateError('props-required', `"${tag}" requires "${required}", so it can't be removed.`, `Make it optional in ${tag} first ("component update ${tag} --interface …"), or remove the element.`, file);
    } else {
      assertValidJsx(changes.root, file, updated, jsx, tag, changes.pending());
    }
  }

  const what = [textParts && 'text', (props.attributes.length || removed.length) && 'props'].filter(Boolean).join(' and ');
  changes.write(file, updated, { type: 'update', message: `updated the ${what} of <${tag}> ${elementId('', element, tree)}` });
  return { id, tag, file, warnings };
}

/** The names an expression reads: `REGISTER_LABEL.en` and `labels[locale]` read REGISTER_LABEL, labels and locale. */
function readNames(node: ts.Node): string[] {
  const names: string[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child) && !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child) && !(ts.isPropertyAssignment(child.parent) && child.parent.name === child)) names.push(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
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
