import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { STYLE_FILE_SUFFIXES } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';

/** A rule at the top level of a CSS file: its selector and where it is, nested blocks (`&:hover {…}`) included. */
export interface CssRule {
  selector: string;
  start: number;
  end: number;
}

/** The top-level rules of a CSS file. At-rules (@media…) are skipped with what they hold. Comments are ignored. */
export function cssRules(text: string): CssRule[] {
  const rules: CssRule[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 1;
      if (depth === 0) start = i + 1;
      continue;
    }
    const char = text[i];
    if (char === '{') depth++;
    else if (char === '}' && depth > 0 && --depth === 0) {
      const head = text.slice(start, text.indexOf('{', start));
      const selector = head.trim();
      if (!selector.startsWith('@')) rules.push({ selector, start: start + head.length - head.trimStart().length, end: i + 1 });
      start = i + 1;
    }
  }
  return rules;
}

/** The class names a selector uses: ".root[data-x] .label:hover" → root, label. */
export function selectorClasses(selector: string): string[] {
  return [...selector.replace(/\[[^\]]*\]/g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]!);
}

/** The class a selector styles: the one of its last compound, ".root[data-x] .label:hover" → label. */
function styledClass(selector: string): string | undefined {
  const last = selector.replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim().split(/[\s>+~]+/).pop() ?? '';
  return /^\.(-?[_a-zA-Z][\w-]*)/.exec(last)?.[1];
}

/**
 * The rules of a style in CSS: ".name {…}", its states (".name:hover", ".name[aria-current]") and the rules styling it
 * inside another (".root[data-selected] .name"), not rules that only mention it (".root:has(.name)").
 * A rule with several selectors goes only when each of them styles the name.
 */
function removeCssRules(text: string, name: string): string {
  let updated = text;
  for (const rule of cssRules(text).reverse()) {
    if (!rule.selector.split(',').every((selector) => styledClass(selector) === name)) continue;
    let lineStart = updated.lastIndexOf('\n', rule.start - 1) + 1;
    // A comment right above the rule describes it: it goes too.
    const comment = /(^|\n)[ \t]*\/\*(?:(?!\*\/)[\s\S])*\*\/[ \t]*\n$/.exec(updated.slice(0, lineStart));
    if (comment) lineStart = comment.index + comment[1]!.length;
    const after = updated.slice(rule.end).match(/^[ \t]*\n?/)![0];
    updated = updated.slice(0, lineStart) + updated.slice(rule.end + after.length);
  }
  return updated.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '\n');
}

/** The property `name` of `export const styles = {…}` in a Tailwind styles file. */
function removeTailwindStyle(text: string, fileName: string, name: string): string {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  let property: ts.ObjectLiteralElementLike | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === name && ts.isObjectLiteralExpression(node.parent)) property = node;
    if (!property) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!property) return text;
  const lineStart = text.lastIndexOf('\n', property.getStart(sourceFile) - 1) + 1;
  const after = text.slice(property.getEnd()).match(/^,?[ \t]*\n?/)![0];
  return text.slice(0, lineStart) + text.slice(property.getEnd() + after.length);
}

/** The style file of a component file: Card.tsx → Card.module.css (or Card.styles.ts with Tailwind). */
export function styleFileOf(config: ResolvedConfig, componentRel: string): string {
  const base = path.posix.basename(componentRel).replace(/\.[jt]sx?$/, '');
  return `${path.posix.dirname(componentRel)}/${base}${STYLE_FILE_SUFFIXES[config.styles]}`;
}

/**
 * Plans removing the styles `names` of a component file from its style file, those nothing in the file uses any more:
 * their rules and states. Returns the names it removed. The root's style stays, unless `withRoot` (the root itself was
 * removed, its content taking its place).
 */
export async function planUnusedStyleRemoval(changes: ChangeSet, config: ResolvedConfig, componentRel: string, componentText: string, names: string[], withRoot = false): Promise<string[]> {
  const unused = [...new Set(names)].filter((name) => (withRoot || name !== 'root') && !new RegExp(`\\bstyles\\.${name}\\b`).test(componentText));
  const styleRel = styleFileOf(config, componentRel);
  const text = unused.length ? await changes.read(styleRel) : undefined;
  if (text === undefined) return [];
  const removed: string[] = [];
  let updated = text;
  for (const name of unused) {
    const next = config.styles === 'tailwind' ? removeTailwindStyle(updated, styleRel, name) : removeCssRules(updated, name);
    if (next !== updated) removed.push(name);
    updated = next;
  }
  if (!removed.length) return [];
  const list = removed.map((name) => `"${name}"`).join(', ');
  changes.write(styleRel, updated, { type: 'update', message: `removed the style${removed.length > 1 ? 's' : ''} ${list}, which nothing uses now` });
  return removed;
}
