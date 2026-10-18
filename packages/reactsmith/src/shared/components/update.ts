import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { STYLE_FILE_SUFFIXES } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';
import { cssValue, MANAGED_STYLES, ROOT_STYLE_KEYS, tailwindClasses, type RootStyle, type RootStyleKey } from '../styles/layout.js';
import { arbitraryProperty, tailwindClassesFor, type Declaration } from '../styles/declarations.js';
import { componentScope, type ComponentOwner } from './scope.js';

/** New values for the root style: a value sets it, null removes it, a missing key keeps it. */
export type RootStyleChanges = { [K in RootStyleKey]?: RootStyle[K] | null };

export interface ComponentUpdateOptions {
  owner: ComponentOwner;
  /** PascalCase component name: "TopBar". */
  name: string;
  style: RootStyleChanges;
  /** CSS declarations to set on the root as given, e.g. from a design team; applied after `style`. */
  css?: Declaration[];
}

function updateError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** The styles that set the layout of the children: setting one needs "display: flex". */
const FLEX_KEYS: readonly RootStyleKey[] = ['direction', 'gap', 'align', 'justify'];

/**
 * Updates the managed declarations of the ".root" rule, then sets the given declarations,
 * keeping every other declaration as written.
 */
function updateCss(text: string, changes: RootStyleChanges, css: Declaration[], fileRel: string): string {
  const rule = /(^|\n)(\.root\s*\{)([^}]*)\}/.exec(text);
  if (!rule) throw updateError('root-style-missing', `${fileRel} has no ".root" rule.`, 'Add ".root { … }", the style of the component\'s root element.', fileRel);
  const bodyStart = rule.index + rule[1]!.length + rule[2]!.length;
  let lines = rule[3]!.split('\n');
  const indent = /^([ \t]+)\S/m.exec(rule[3]!)?.[1] ?? '  ';
  const lastDeclaration = () => lines.reduce((last, line, index) => (line.trim() ? index : last), 0);
  const declarationOf = (property: string) => lines.findIndex((line) => new RegExp(`^\\s*${property}\\s*:`).test(line));

  for (const key of ROOT_STYLE_KEYS) {
    if (!(key in changes)) continue;
    const property = MANAGED_STYLES[key].css;
    const at = declarationOf(property);
    const value = changes[key] === null ? undefined : cssValue(key, changes as RootStyle);
    if (value === undefined) {
      if (at !== -1) lines = lines.filter((_, index) => index !== at);
      continue;
    }
    const declaration = `${indent}${property}: ${value};`;
    if (at !== -1) lines[at] = declaration;
    else lines.splice(lastDeclaration() + 1, 0, declaration);
  }
  const setsFlex = FLEX_KEYS.some((key) => changes[key] !== undefined && changes[key] !== null);
  if (setsFlex && declarationOf('display') === -1) lines.splice(lines[0]?.trim() ? 0 : 1, 0, `${indent}display: flex;`);

  for (const [property, value] of css) {
    const at = declarationOf(property);
    const declaration = `${indent}${property}: ${value};`;
    if (at !== -1) lines[at] = declaration;
    else lines.splice(lastDeclaration() + 1, 0, declaration);
  }

  let body = lines.join('\n');
  if (!body.startsWith('\n')) body = `\n${body}`;
  if (!body.endsWith('\n')) body = `${body}\n`;
  return text.slice(0, bodyStart) + body + text.slice(bodyStart + rule[3]!.length);
}

/** Updates the managed classes of `root` in the styles object, keeping every other class in place. */
function updateTailwind(text: string, changes: RootStyleChanges, css: Declaration[], fileRel: string): string {
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true);
  let literal: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined;
  const visit = (node: ts.Node): void => {
    if (literal) return;
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'root' && ts.isStringLiteralLike(node.initializer)) {
      literal = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!literal) throw updateError('root-style-missing', `${fileRel} has no "root" classes.`, "Add root: '…' to the styles object: the classes of the component's root element.", fileRel);

  let classes = literal.text.split(/\s+/).filter(Boolean);
  for (const key of ROOT_STYLE_KEYS) {
    if (!(key in changes)) continue;
    const pattern = MANAGED_STYLES[key].tailwind;
    const at = classes.findIndex((name) => pattern.test(name));
    classes = classes.filter((name) => !pattern.test(name));
    const added = changes[key] === null ? [] : tailwindClasses(key, changes as RootStyle);
    classes.splice(at === -1 ? classes.length : at, 0, ...added);
  }
  if (FLEX_KEYS.some((key) => changes[key] !== undefined && changes[key] !== null) && !classes.includes('flex')) classes.unshift('flex');
  // Given declarations become arbitrary properties, replacing the classes that set the same property.
  for (const declaration of css) {
    const pattern = tailwindClassesFor(declaration[0]);
    classes = [...classes.filter((name) => !pattern.test(name)), arbitraryProperty(declaration)];
  }

  const quote = text[literal.getStart(sourceFile)]!;
  return text.slice(0, literal.getStart(sourceFile)) + quote + classes.join(' ') + quote + text.slice(literal.getEnd());
}

/** "gap var(--space-4), padding removed, css display, gap" for the report. */
function describe(changes: RootStyleChanges, css: Declaration[], config: ResolvedConfig): string {
  const layout = ROOT_STYLE_KEYS.filter((key) => key in changes)
    .map((key) => {
      if (changes[key] === null) return `${key} removed`;
      const value = config.styles === 'tailwind' ? tailwindClasses(key, changes as RootStyle).join(' ') : cssValue(key, changes as RootStyle);
      return `${key} ${value}`;
    });
  const given = css.length ? [`css ${css.map(([property]) => property).join(', ')}`] : [];
  return [...layout, ...given].join(', ');
}

/**
 * Plans updating the root style of a component, in its own style file: only the given layout styles change,
 * then the given CSS declarations are set as they are. Declarations or classes written by hand are kept.
 */
export async function planComponentUpdate(changes: ChangeSet, config: ResolvedConfig, options: ComponentUpdateOptions): Promise<void> {
  const { owner, name, style } = options;
  const css = options.css ?? [];
  const scope = componentScope(config, owner);
  const dirRel = `${scope.componentsRel}/${name}`;
  if (Object.keys(style).length === 0 && css.length === 0) {
    throw updateError('update-nothing', 'Nothing to update.', 'Pass --css with declarations, or at least one of --direction, --gap, --align, --justify or --padding ("none" removes it).');
  }
  if ((await changes.read(`${dirRel}/${name}.tsx`)) === undefined) {
    throw updateError('component-missing', `There is no component "${name}" in ${scope.label}.`, 'Check the name, and --feature or --app.', dirRel);
  }
  const styleRel = `${dirRel}/${name}${STYLE_FILE_SUFFIXES[config.styles]}`;
  const text = await changes.read(styleRel);
  if (text === undefined) {
    throw updateError('style-file-missing', `Component "${name}" has no style file ${styleRel}.`, 'Create it with a root style, and use it on the root element: className={styles.root}.', styleRel);
  }

  const updated = config.styles === 'tailwind' ? updateTailwind(text, style, css, styleRel) : updateCss(text, style, css, styleRel);
  if (updated === text) {
    changes.skip(styleRel, `root style already has ${describe(style, css, config)}`);
    return;
  }
  changes.write(styleRel, updated, { type: 'update', message: `root style: ${describe(style, css, config)}` });
}
