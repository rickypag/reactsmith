import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { removalRange } from '../code/remove.js';
import { STYLE_FILE_SUFFIXES } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { planConfigUpdate } from '../config/write.js';
import { listFiles, toRelative } from '../files.js';
import { IssueError, type Issue } from '../issues.js';
import { TOKEN_KINDS } from '../tokens/kinds.js';
import { planTokens } from '../tokens/engine.js';
import { globalStylesPath } from './global.js';
import { spaceValue } from './layout.js';
import { stateSelector } from './declarations.js';
import { selectorRank } from './update.js';

/**
 * A declaration of a style, under a breakpoint ("" for none), a selector prefix (the group's state, as --when writes
 * a condition: '.root[data-tone="dark"] ', "" for none) and a suffix (":hover:not(:disabled)", "" for the element itself).
 */
interface Placed {
  at: string;
  prefix: string;
  suffix: string;
  property: string;
  value: string;
}

/** What the classes of one style become: its declarations, and the classes no CSS could be read from. */
interface ConvertedStyle {
  name: string;
  declarations: Placed[];
  leftovers: string[];
}

const ALIGN: Record<string, string> = { start: 'flex-start', end: 'flex-end', center: 'center', stretch: 'stretch', baseline: 'baseline' };
const JUSTIFY: Record<string, string> = { start: 'flex-start', end: 'flex-end', center: 'center', between: 'space-between', around: 'space-around', evenly: 'space-evenly' };
const DISPLAY: Record<string, string> = { flex: 'flex', 'inline-flex': 'inline-flex', block: 'block', 'inline-block': 'inline-block', inline: 'inline', grid: 'grid', 'inline-grid': 'inline-grid', contents: 'contents', hidden: 'none' };
const STEP = /^\d+(\.5)?$/;

/**
 * Utilities with a fixed CSS: those the commands' own templates write (layout create: shrink-0, h-14, border-b…), as
 * Tailwind defines them, and a few common ones. A border width comes with its style, which Tailwind's reset gives.
 */
const FIXED: Record<string, [string, string][]> = {
  'shrink-0': [['flex-shrink', '0']],
  grow: [['flex-grow', '1']],
  'flex-1': [['flex', '1']],
  'flex-wrap': [['flex-wrap', 'wrap']],
  'h-full': [['height', '100%']],
  'h-screen': [['height', '100vh']],
  'h-14': [['height', '3.5rem']],
  'w-full': [['width', '100%']],
  'w-60': [['width', '15rem']],
  'min-h-0': [['min-height', '0']],
  'min-h-screen': [['min-height', '100vh']],
  'min-w-0': [['min-width', '0']],
  'overflow-auto': [['overflow', 'auto']],
  'overflow-hidden': [['overflow', 'hidden']],
  relative: [['position', 'relative']],
  absolute: [['position', 'absolute']],
  border: [['border-width', '1px'], ['border-style', 'solid']],
  'border-t': [['border-top-width', '1px'], ['border-top-style', 'solid']],
  'border-r': [['border-right-width', '1px'], ['border-right-style', 'solid']],
  'border-b': [['border-bottom-width', '1px'], ['border-bottom-style', 'solid']],
  'border-l': [['border-left-width', '1px'], ['border-left-style', 'solid']],
  'border-border': [['border-color', 'var(--color-border)']],
  'animate-spin': [['animation', 'spin 1s linear infinite']],
};

/** Keyframes an animation utility needs in the module, by the name its animation uses. */
const KEYFRAMES: Record<string, string> = { spin: '@keyframes spin {\n  to {\n    transform: rotate(360deg);\n  }\n}' };

/** "nav:not-disabled:hover:[color:red]" → ["nav", "not-disabled", "hover", "[color:red]"]: colons inside brackets don't split. */
function splitVariants(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '[') depth++;
    else if (char === ']') depth--;
    if (char === ':' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  return [...parts, current];
}

/** "[k=v]" of an aria-/data- variant → '[aria-k="v"]'. */
function attributeSuffix(prefix: 'aria' | 'data', bracket: string): string | undefined {
  const match = /^\[([\w-]+)=([^\]]+)\]$/.exec(bracket);
  return match ? `[${prefix}-${match[1]}="${match[2]!.replace(/_/g, ' ')}"]` : undefined;
}

/**
 * The selector suffix of the variants after the breakpoint, as the commands write states in CSS: undefined when one
 * isn't something a CSS Modules rule of the element itself can say (group-…, peer-…, a variant of the dev's).
 */
function variantSuffix(variants: string[]): string | undefined {
  let suffix = '';
  if (variants.some((variant) => variant.startsWith('group-'))) return undefined;
  for (let index = 0; index < variants.length; index++) {
    const variant = variants[index]!;
    if (variant === 'not-disabled' && (variants[index + 1] === 'hover' || variants[index + 1] === 'active')) {
      suffix += stateSelector(variants[++index] as 'hover' | 'active');
    } else if (['hover', 'active', 'focus', 'focus-visible', 'focus-within', 'disabled', 'checked', 'first', 'last'].includes(variant)) {
      suffix += variant === 'first' || variant === 'last' ? `:${variant}-child` : `:${variant}`;
    } else if (variant === 'placeholder' || variant === 'before' || variant === 'after') {
      suffix += `::${variant}`;
    } else if (variant === 'open') {
      suffix += '[open]';
    } else if (variant === 'aria-pressed' || variant === 'aria-selected' || variant === 'aria-expanded') {
      suffix += `[${variant}="true"]`;
    } else if (variant.startsWith('aria-[') || variant.startsWith('data-[')) {
      const attribute = attributeSuffix(variant.startsWith('aria') ? 'aria' : 'data', variant.slice(5));
      if (!attribute) return undefined;
      suffix += attribute;
    } else return undefined;
  }
  return suffix;
}

/**
 * The prefix and suffix of the variants after the breakpoint. A group variant (group-data-[tone=dark]:) is a state of
 * the style that carries "group", written before the element as --when writes a condition on the root.
 */
function variantSelector(variants: string[], group: string | undefined): { prefix: string; suffix: string } | undefined {
  const groupAt = variants.findIndex((variant) => variant.startsWith('group-'));
  if (groupAt === -1) {
    const suffix = variantSuffix(variants);
    return suffix === undefined ? undefined : { prefix: '', suffix };
  }
  if (group === undefined) return undefined;
  const state = variantSuffix([variants[groupAt]!.slice('group-'.length)]);
  const suffix = variantSuffix(variants.filter((_, index) => index !== groupAt));
  return state === undefined || suffix === undefined ? undefined : { prefix: `.${group}${state} `, suffix };
}

/** The declarations a utility class sets: "[font-size:13px]" → font-size: 13px, "gap-2" → gap: var(--space-2). Undefined for others. */
function utilityDeclarations(utility: string): [string, string][] | undefined {
  const arbitrary = /^\[(--[\w-]+|-?[a-z][a-z0-9-]*):(.+)\]$/.exec(utility);
  if (arbitrary) {
    // Tailwind writes spaces as "_", and a real "_" as "\_".
    const value = arbitrary[2]!.replace(/\\_/g, '\u0000').replace(/_/g, ' ').replace(/\u0000/g, '_');
    return [[arbitrary[1]!, value]];
  }
  if (utility in DISPLAY) return [['display', DISPLAY[utility]!]];
  if (utility in FIXED) return FIXED[utility]!;
  const direction = /^flex-(row|col)(-reverse)?$/.exec(utility);
  if (direction) return [['flex-direction', `${direction[1] === 'col' ? 'column' : 'row'}${direction[2] ?? ''}`]];
  const step = (prefix: string) => {
    const match = new RegExp(`^${prefix}-(.+)$`).exec(utility);
    return match && STEP.test(match[1]!) ? spaceValue(Number(match[1])) : undefined;
  };
  const sides: [string, string][] = [['gap', 'gap'], ['p', 'padding'], ['px', 'padding-inline'], ['py', 'padding-block'], ['pt', 'padding-top'], ['pr', 'padding-right'], ['pb', 'padding-bottom'], ['pl', 'padding-left']];
  for (const [prefix, property] of sides) {
    const value = step(prefix);
    if (value !== undefined) return [[property, value]];
  }
  const items = /^items-(\w+)$/.exec(utility);
  if (items && ALIGN[items[1]!]) return [['align-items', ALIGN[items[1]!]!]];
  const justify = /^justify-(\w+)$/.exec(utility);
  if (justify && JUSTIFY[justify[1]!]) return [['justify-content', JUSTIFY[justify[1]!]!]];
  return undefined;
}

/** Reads the classes of one style back into CSS declarations, by breakpoint and state. */
function convertClasses(name: string, classes: string, breakpoints: Record<string, string>, group: string | undefined): ConvertedStyle {
  const declarations: Placed[] = [];
  const leftovers: string[] = [];
  for (const written of classes.split(/\s+/).filter(Boolean)) {
    // "group" only marks the element its children's group-… variants look at: it has no CSS of its own.
    if (written === 'group' && group === name) continue;
    const parts = splitVariants(written);
    const utility = parts.pop()!;
    const at = parts[0] !== undefined && parts[0] in breakpoints ? parts.shift()! : '';
    const selector = variantSelector(parts, group);
    const found = selector === undefined ? undefined : utilityDeclarations(utility);
    if (!found) {
      leftovers.push(written);
      continue;
    }
    for (const [property, value] of found) declarations.push({ at, prefix: selector!.prefix, suffix: selector!.suffix, property, value });
  }
  // "py-2 px-4" is one padding, as the commands write it.
  for (const at of new Set(declarations.map((declaration) => declaration.at))) {
    for (const place of new Set(declarations.filter((declaration) => declaration.at === at).map((declaration) => `${declaration.prefix}|${declaration.suffix}`))) {
      const here = (property: string) => declarations.find((declaration) => declaration.at === at && `${declaration.prefix}|${declaration.suffix}` === place && declaration.property === property);
      const [block, inline] = [here('padding-block'), here('padding-inline')];
      if (block && inline) {
        block.property = 'padding';
        block.value = `${block.value} ${inline.value}`;
        declarations.splice(declarations.indexOf(inline), 1);
      }
    }
  }
  return { name, declarations, leftovers };
}


/** The rules of the styles at one breakpoint ("" for none), each declaration once, the last one written winning. */
function rulesAt(styles: ConvertedStyle[], at: string, indent: string): string[] {
  const rules: string[] = [];
  for (const style of styles) {
    const here = style.declarations.filter((declaration) => declaration.at === at);
    const selectorOf = (declaration: Placed) => `${declaration.prefix}.${style.name}${declaration.suffix}`;
    const own = `.${style.name}`;
    const selectors = [...new Set([own, ...here.map(selectorOf)])].sort((a, b) => selectorRank(a) - selectorRank(b));
    for (const selector of selectors) {
      const properties = new Map<string, string>();
      for (const declaration of here.filter((candidate) => selectorOf(candidate) === selector)) {
        properties.delete(declaration.property);
        properties.set(declaration.property, declaration.value);
      }
      const notes = at === '' && selector === own && style.leftovers.length ? [`${indent}  /* Tailwind classes to write as CSS by hand: ${style.leftovers.join(' ')} */`] : [];
      // The element's own rule is always written, so its class exists; the others only with declarations.
      if (!properties.size && !notes.length && (selector !== own || at !== '')) continue;
      const body = [...notes, ...[...properties].map(([property, value]) => `${indent}  ${property}: ${value};`)];
      rules.push(`${indent}${selector} {\n${body.length ? `${body.join('\n')}\n` : ''}${indent}}`);
    }
  }
  return rules;
}

/** A styles file's CSS module: the base rules, then a block per breakpoint, in the order of the config. */
function moduleCss(styles: ConvertedStyle[], breakpoints: Record<string, string>): string {
  const blocks = [rulesAt(styles, '', '').join('\n\n')];
  for (const [name, query] of Object.entries(breakpoints)) {
    const rules = rulesAt(styles, name, '  ');
    if (rules.length) blocks.push(`@media ${query} {\n${rules.join('\n\n')}\n}`);
  }
  // The keyframes the animations use, once each, after the rules.
  const animations = new Set(styles.flatMap((style) => style.declarations.filter((declaration) => declaration.property === 'animation').map((declaration) => declaration.value.split(' ')[0]!)));
  for (const animation of animations) if (KEYFRAMES[animation]) blocks.push(KEYFRAMES[animation]!);
  return `${blocks.filter(Boolean).join('\n\n')}\n`;
}

/** The styles of `export const styles = { root: '…' }`, in order; undefined when the file isn't that shape. */
function readStylesObject(fileRel: string, text: string): [string, string][] | undefined {
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true);
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'styles' || !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue;
      const entries: [string, string][] = [];
      for (const property of declaration.initializer.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) return undefined;
        entries.push([property.name.getText(sourceFile).replace(/^['"]|['"]$/g, ''), property.initializer.text]);
      }
      return entries;
    }
  }
  return undefined;
}

/**
 * `import { styles } from './Name.styles';` → `import styles from './Name.module.css';`, in every file that imports it,
 * moved after the other imports: stylesheets load in import order, so a parent's rules for a child component then
 * come after the child's own and win, as they did in Tailwind's single stylesheet.
 */
function rewriteImport(text: string, fileRel: string, base: string): string | undefined {
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  for (const statement of imports) {
    if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== `./${base}.styles`) continue;
    const bindings = statement.importClause?.namedBindings;
    const binding = bindings && ts.isNamedImports(bindings) && bindings.elements.length === 1 ? bindings.elements[0] : undefined;
    if (!binding || (binding.propertyName ?? binding.name).text !== 'styles') return undefined;
    const line = `import ${binding.name.text} from './${base}.module.css';`;
    const last = imports[imports.length - 1]!;
    if (last === statement) return `${text.slice(0, statement.getStart(sourceFile))}${line}${text.slice(statement.getEnd())}`;
    const [start, end] = removalRange(text, statement.getStart(sourceFile), statement.getEnd());
    return `${text.slice(0, start)}${text.slice(end, last.getEnd())}\n${line}${text.slice(last.getEnd())}`;
  }
  return undefined;
}

const NEXT_CONFIGS = ['next.config.ts', 'next.config.mjs', 'next.config.js'];

/**
 * create-next-app's Tailwind setup runs every "*.css" file through Tailwind's Turbopack loader "as" plain CSS, which
 * takes CSS modules for global stylesheets: their classes would be undefined. The rule is narrowed to the global
 * stylesheet, the one file Tailwind still reads. A rule of another shape is left as it is, with a warning.
 */
async function planNextCssRule(changes: ChangeSet, globalRel: string | undefined): Promise<Issue[]> {
  for (const fileRel of NEXT_CONFIGS) {
    const text = await changes.read(fileRel);
    if (text === undefined || !text.includes('@tailwindcss/turbopack')) continue;
    const rule = /(["'])\*\.css\1(\s*:)/.exec(text);
    if (rule && globalRel) {
      const key = `${rule[1]}${path.posix.basename(globalRel)}${rule[1]}`;
      changes.write(fileRel, `${text.slice(0, rule.index)}${key}${rule[2]}${text.slice(rule.index + rule[0].length)}`, { type: 'update', message: `Tailwind's loader reads ${path.posix.basename(globalRel)} only, so CSS modules stay modules` });
      return [];
    }
    return [{
      severity: 'warning',
      code: 'styles-next-css-rule',
      path: fileRel,
      message: `${fileRel} runs CSS through Tailwind's Turbopack loader, which may turn CSS modules into global CSS.`,
      hint: 'Limit the loader\'s rule to the global stylesheet, e.g. "global.css" instead of "*.css", then check a component\'s class is set.',
    }];
  }
  return [];
}

export interface ConvertResult {
  files: number;
  warnings: Issue[];
}

/**
 * Plans converting a Tailwind project's styles to CSS Modules: each Name.styles.ts becomes Name.module.css, with the
 * rules, states and breakpoint blocks the commands write, and its imports follow; the config and the token files
 * switch too. Classes that aren't the commands' (animate-spin, group-…) stay in their rule as a comment, reported, to
 * write as CSS by hand. The global stylesheet is left as it is: its Tailwind import also brings Tailwind's reset.
 */
export async function planConvertToCssModules(changes: ChangeSet, config: ResolvedConfig): Promise<ConvertResult> {
  if (config.styles !== 'tailwind') {
    throw new IssueError({ severity: 'error', code: 'styles-already-css-modules', message: 'The styles are already CSS Modules.', hint: 'Nothing to convert.' });
  }
  const suffix = STYLE_FILE_SUFFIXES.tailwind;
  const srcDir = path.join(changes.root, config.srcDir);
  const styleFiles = (await listFiles(srcDir)).filter((file) => file.endsWith(suffix)).map((file) => toRelative(changes.root, file));
  const warnings: Issue[] = [];

  for (const fileRel of styleFiles) {
    const text = (await changes.read(fileRel))!;
    const entries = readStylesObject(fileRel, text);
    if (!entries) {
      throw new IssueError({
        severity: 'error',
        code: 'styles-object-unreadable',
        path: fileRel,
        message: `${fileRel} is not "export const styles = { name: '…' }" with a string of classes per style.`,
        hint: 'Write each style as a plain string of classes, then convert again. Nothing was changed.',
      });
    }
    // The style marked "group", when exactly one is: its children's group-… variants are its states.
    const groups = entries.filter(([, classes]) => classes.split(/\s+/).includes('group')).map(([name]) => name);
    const group = groups.length === 1 ? groups[0] : undefined;
    const styles = entries.map(([name, classes]) => convertClasses(name, classes, config.breakpoints, group));
    const dir = path.posix.dirname(fileRel);
    const base = path.posix.basename(fileRel, suffix);
    changes.write(`${dir}/${base}${STYLE_FILE_SUFFIXES['css-modules']}`, moduleCss(styles, config.breakpoints), { type: 'create', message: `converted from ${base}${suffix}` });
    changes.delete(fileRel, `converted to ${base}${STYLE_FILE_SUFFIXES['css-modules']}`);
    for (const style of styles.filter((candidate) => candidate.leftovers.length)) {
      warnings.push({
        severity: 'warning',
        code: 'style-classes-by-hand',
        path: `${dir}/${base}${STYLE_FILE_SUFFIXES['css-modules']}`,
        message: `.${style.name}: ${style.leftovers.join(' ')} ${style.leftovers.length === 1 ? 'is a Tailwind class' : 'are Tailwind classes'} with no CSS of the commands; ${style.leftovers.length === 1 ? 'it is' : 'they are'} left as a comment in the rule.`,
        hint: 'Write the CSS they stand for in the rule by hand (e.g. animate-spin is an animation with @keyframes), then delete the comment.',
      });
    }
    // The files of the folder that import the styles.
    for (const file of (await listFiles(path.join(changes.root, dir))).filter((candidate) => /\.(tsx?|jsx?)$/.test(candidate) && path.dirname(candidate) === path.join(changes.root, dir))) {
      const rel = toRelative(changes.root, file);
      if (rel === fileRel) continue;
      const updated = rewriteImport((await changes.read(rel))!, rel, base);
      if (updated !== undefined) changes.write(rel, updated, { type: 'update', message: `imports ${base}${STYLE_FILE_SUFFIXES['css-modules']}` });
    }
  }

  await planConfigUpdate(changes, { styles: 'css-modules' });
  const converted = { ...config, styles: 'css-modules' as const };
  for (const kind of TOKEN_KINDS) await planTokens(changes, converted, kind);

  const globalRel = globalStylesPath(config);
  warnings.push(...(await planNextCssRule(changes, globalRel)));
  const global = globalRel ? await changes.read(globalRel) : undefined;
  if (global && /@import\s+["']tailwindcss["']/.test(global)) {
    warnings.push({
      severity: 'warning',
      code: 'styles-tailwind-still-imported',
      path: globalRel,
      message: `${globalRel} still imports Tailwind, whose reset the pages rely on; nothing else needs it any more.`,
      hint: 'Leave it, or remove the import and its @custom-variant lines, and check the pages still look the same (Tailwind\'s reset sets margins, borders and box sizing).',
    });
  }
  return { files: styleFiles.length, warnings };
}
