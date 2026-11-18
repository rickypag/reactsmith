import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../../changes.js';
import { addImport, addNamedImport } from '../../code/insert.js';
import { isImported, isReferenced, isStillUsed, removeImport } from '../../code/remove.js';
import type { ResolvedConfig } from '../../config/types.js';
import { componentFunction } from '../../elements/tree.js';
import { displayState, elementKind, flexDisplay, isHtmlTag, layoutRefusal, takesLayout } from '../../elements/kinds.js';
import { isTableElement } from '../../elements/table.js';
import { parseAttributes } from '../../elements/props.js';
import { findComponentSource } from '../../imports/lookup.js';
import { IssueError, type Issue } from '../../issues.js';
import { declaresChildren } from '../../layout/classify.js';
import { DEFAULT_LAYOUT, rootStyleFile, type RootStyle } from '../../styles/layout.js';
import { appendBeforeBreakpoints } from '../../styles/breakpoint-blocks.js';
import { cssRules, selectorClasses } from '../../styles/remove.js';
import { isStyleableComponent, planComponentStyling, styleableProp } from '../../styles/styleable.js';
import { listUnits } from '../../tree/list-units.js';
import { applyNames, undestructureProp } from '../../values/scope.js';
import { componentScope, type ComponentOwner } from '../scope.js';
import type { DraftElement } from './parse.js';

/** The component whose JSX a draft replaces. */
export interface ReplaceTarget {
  name: string;
  /** Its folder, project-relative. */
  folderRel: string;
  /** Its file, project-relative. */
  fileRel: string;
}

function replaceError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/**
 * Finds the component to replace, by its name: names are unique in a project. `owner`, when given, says where it must
 * be. Views and layouts are not replaced: only components.
 */
export async function findReplaceTarget(changes: ChangeSet, config: ResolvedConfig, name: string, owner: ComponentOwner | undefined): Promise<ReplaceTarget> {
  if (owner) {
    const folderRel = `${componentScope(config, owner).componentsRel}/${name}`;
    const fileRel = `${folderRel}/${name}.tsx`;
    if ((await changes.read(fileRel)) === undefined) {
      throw replaceError('component-missing', `There is no component "${name}" in ${componentScope(config, owner).label}.`, 'Check the name, or leave out --feature/--app/--type: --replace finds the component by its name.', folderRel);
    }
    return { name, folderRel, fileRel };
  }
  const units = (await listUnits(changes.root, config)).filter((unit) => unit.name === name);
  const component = units.find((unit) => unit.kind === 'component');
  if (!component) {
    const other = units[0];
    throw replaceError(
      'component-missing',
      other ? `"${name}" is a ${other.kind}: --replace replaces the JSX of a component.` : `There is no component "${name}".`,
      other ? 'Change a view or a layout with the element commands.' : 'Check the name, or create it without --replace.',
      other?.folderRel,
    );
  }
  return { name, folderRel: component.folderRel, fileRel: `${component.folderRel}/${name}.tsx` };
}

/** The one JSX expression the component returns: an arrow's body, or its only return. */
function returnedJsx(fn: ts.ArrowFunction, name: string, fileRel: string): ts.Expression {
  const unwrap = (expression: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression);
  let returned: ts.Expression[];
  if (ts.isBlock(fn.body)) {
    returned = [];
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) returned.push(node.expression);
      ts.forEachChild(node, visit);
    };
    fn.body.statements.forEach(visit);
  } else returned = [fn.body];
  if (returned.length !== 1) {
    throw replaceError(
      'replace-return-ambiguous',
      `${name} has ${returned.length} returns: --replace replaces one.`,
      'Move the other returns into the JSX by hand (e.g. a condition on a name), or replace them by hand.',
      fileRel,
    );
  }
  const expression = unwrap(returned[0]!);
  if (!ts.isJsxElement(expression) && !ts.isJsxSelfClosingElement(expression) && !ts.isJsxFragment(expression)) {
    throw replaceError('replace-return-not-jsx', `${name} doesn't return JSX directly.`, 'Make it return its JSX, then replace it.', fileRel);
  }
  return expression;
}

/** Where the JSX a component returns starts and ends in `text`, or undefined when it can't be read. */
export function returnedRange(text: string, fileRel: string, name: string): [number, number] | undefined {
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = componentFunction(sourceFile, name);
  if (!fn) return undefined;
  try {
    const node = returnedJsx(fn, name, fileRel);
    return [node.getStart(sourceFile), node.getEnd()];
  } catch {
    return undefined;
  }
}

/** The names the old JSX reads (tags, values, list items): after the replace, their imports and props may be unused. */
function namesIn(node: ts.Node): string[] {
  const names = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) {
      const parent = child.parent;
      const isMember = ts.isPropertyAccessExpression(parent) && parent.name === child;
      if (!isMember && !ts.isJsxAttribute(parent)) names.add(child.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return [...names];
}

/**
 * Plans the start of a replace: the JSX the component returns becomes the draft's root, empty, and the style file
 * holds only the root's style, as `component create` writes it. Everything before the return stays. Returns what
 * `planReplaceCleanup` needs once the draft is in.
 */
export async function planReturnReplace(changes: ChangeSet, config: ResolvedConfig, target: ReplaceTarget, root: DraftElement, rootLayout: RootStyle | undefined): Promise<ReplaceStart> {
  const { name, fileRel, folderRel } = target;
  const text = (await changes.read(fileRel))!;
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = componentFunction(sourceFile, name);
  if (!fn) throw replaceError('replace-component-unreadable', `No component function "${name}" was found in ${fileRel}.`, `It must be an exported const arrow function: export const ${name} = …`, fileRel);
  const old = returnedJsx(fn, name, fileRel);
  const oldNames = namesIn(old);

  const tag = root.tag;
  const source = isHtmlTag(tag) ? undefined : await findComponentSource(changes, config, fileRel, text, tag, root.from);
  const kind = elementKind(config, tag, source?.kindSource);
  const takesChildren = source?.kind === 'project' && declaresChildren((await changes.read(`${source.folderRel}/${tag}.tsx`)) ?? '', tag);
  if (rootLayout && !takesLayout(kind, tag, takesChildren)) {
    const refusal = layoutRefusal(tag);
    throw replaceError(refusal.code, `Line ${root.line}: ${refusal.message}`, refusal.hint, fileRel);
  }
  // The root's own component takes the class of this component's style file.
  if (source?.kind === 'project') {
    await planComponentStyling(changes, config, source.folderRel!, tag, parseAttributes(root.props, tag).attributes.map((attribute) => attribute.name), true);
  }

  // A styleable component keeps merging the class its parent passes: className={cx(styles.root, className)}.
  const className = isStyleableComponent(sourceFile, name) ? `cx(styles.root, ${await styleableProp(changes, config)})` : 'styles.root';
  const rootJsx = root.rendersChildren ? `<${tag} className={${className}}>{children}</${tag}>` : `<${tag} className={${className}} />`;
  let updated = `${text.slice(0, old.getStart(sourceFile))}${rootJsx}${text.slice(old.getEnd())}`;
  if (source && !source.imported) updated = addNamedImport(updated, fileRel, tag, source.specifier);
  if (root.rendersChildren) updated = applyNames(updated, fileRel, name, ['children'], { hint: `Declare it first: component update ${name} --interface "children: React.ReactNode".` });

  // The style file holds only the root's style, with the layout the draft gives it, or the default one of its kind,
  // as component create writes it.
  const layout: RootStyle | undefined = rootLayout
    ? { ...rootLayout, direction: rootLayout.direction ?? (kind === 'interactive' ? 'row' : DEFAULT_LAYOUT.direction) }
    : kind === 'layout' && !isTableElement(tag)
      ? DEFAULT_LAYOUT
      : undefined;
  const style = rootStyleFile(config.styles, name, layout, undefined, flexDisplay(kind), displayState(tag));
  if (!isImported(updated, 'styles')) updated = addImport(updated, ts.createSourceFile(fileRel, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), style.importStatement);
  changes.write(fileRel, updated, { type: 'update', message: `replaced the JSX of ${name} with <${tag}>` });
  const styleRel = `${folderRel}/${style.fileName}`;
  // Rules written by hand in a CSS file are put back once the draft is in (Tailwind keeps classes, not rules).
  const oldStyles = config.styles === 'css-modules' ? await changes.read(styleRel) : undefined;
  changes.write(styleRel, style.content, { type: 'update', message: 'replaced the styles with the root\'s' });
  return { oldNames, styleRel, oldStyles, breakpoints: config.breakpoints };
}

/** What a replace keeps from before the draft, for its cleanup. */
export interface ReplaceStart {
  /** The names the old JSX read: their imports and props may be unused after the draft. */
  oldNames: string[];
  styleRel: string;
  /** The old CSS style file, for the rules written by hand. Undefined with Tailwind. */
  oldStyles?: string;
  /** The config's breakpoints: rules put back go before their @media blocks. */
  breakpoints: Record<string, string>;
}

/**
 * Plans the end of a replace: imports and destructured props that only the old JSX used go, now that nothing reads
 * them. Logic written by hand stays, even when the new JSX no longer uses it, and so do the style file's rules written
 * by hand. Returns warnings saying which rules were kept, and which went with their elements.
 */
export async function planReplaceCleanup(changes: ChangeSet, target: ReplaceTarget, { oldNames, styleRel, oldStyles, breakpoints }: ReplaceStart): Promise<Issue[]> {
  const { name, fileRel } = target;
  let updated = (await changes.read(fileRel))!;
  const dropped: string[] = [];
  for (const old of oldNames) {
    if (old === 'styles' || old === name) continue;
    if (isImported(updated, old) && !isStillUsed(updated, old)) {
      updated = removeImport(updated, old);
      dropped.push(old);
    } else if (!isReferenced(updated, old)) {
      const next = undestructureProp(updated, path.basename(fileRel), name, old);
      if (next !== undefined) {
        updated = next;
        dropped.push(old);
      }
    }
  }
  if (dropped.length) changes.write(fileRel, updated, { type: 'update', message: `removed ${dropped.join(', ')}, which only the old JSX used` });
  return oldStyles === undefined ? [] : planHandRulesKept(changes, styleRel, oldStyles, updated, breakpoints);
}

/**
 * Puts back the old style file's rules that aren't an element's own style. ".name {…}", with its nested states, is the
 * element's style, which the draft gives again. Any other rule (".root[aria-pressed='true']", ".list > .item") was
 * written by hand: it is kept when the new JSX still has its classes and the draft didn't write the same selector.
 * At-rules (@media…) are not kept.
 */
async function planHandRulesKept(changes: ChangeSet, styleRel: string, oldStyles: string, componentText: string, breakpoints: Record<string, string>): Promise<Issue[]> {
  const current = (await changes.read(styleRel)) ?? '';
  const normalize = (selector: string) => selector.replace(/\s+/g, ' ');
  const written = new Set(cssRules(current).map((rule) => normalize(rule.selector)));
  const used = new Set(['root', ...[...componentText.matchAll(/\bstyles\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]!)]);
  const kept: string[] = [];
  const keptSelectors: string[] = [];
  const gone: string[] = [];
  for (const rule of cssRules(oldStyles)) {
    const selector = normalize(rule.selector);
    if (/^\.-?[_a-zA-Z][\w-]*$/.test(selector) || written.has(selector)) continue;
    if (selectorClasses(selector).every((name) => used.has(name))) {
      kept.push(oldStyles.slice(rule.start, rule.end));
      keptSelectors.push(selector);
    } else {
      gone.push(selector);
    }
  }
  if (kept.length) changes.write(styleRel, appendBeforeBreakpoints(current, breakpoints, `${kept.join('\n\n')}\n`), { type: 'update', message: 'kept the rules written by hand' });
  const issues: Issue[] = [];
  if (keptSelectors.length) {
    issues.push({ severity: 'warning', code: 'replace-rules-kept', path: styleRel, message: `Kept the rules written by hand: ${keptSelectors.join(', ')}.`, hint: 'Remove any the new JSX no longer needs.' });
  }
  if (gone.length) {
    issues.push({ severity: 'warning', code: 'replace-rules-dropped', path: styleRel, message: `Dropped the rules written by hand for elements the new JSX doesn't have: ${gone.join(', ')}.`, hint: 'Write them again for the new elements if they are still needed.' });
  }
  return issues;
}
