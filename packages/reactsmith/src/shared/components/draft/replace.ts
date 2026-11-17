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
import { IssueError } from '../../issues.js';
import { declaresChildren } from '../../layout/classify.js';
import { DEFAULT_LAYOUT, rootStyleFile, type RootStyle } from '../../styles/layout.js';
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
 * holds only the root's style, as `component create` writes it. Everything before the return stays. Returns the
 * names the old JSX read, for `planReplaceCleanup` once the draft is in.
 */
export async function planReturnReplace(changes: ChangeSet, config: ResolvedConfig, target: ReplaceTarget, root: DraftElement, rootLayout: RootStyle | undefined): Promise<string[]> {
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
  changes.write(`${folderRel}/${style.fileName}`, style.content, { type: 'update', message: 'replaced the styles with the root\'s' });
  return oldNames;
}

/**
 * Plans the end of a replace: imports and destructured props that only the old JSX used go, now that nothing reads
 * them. Logic written by hand stays, even when the new JSX no longer uses it.
 */
export async function planReplaceCleanup(changes: ChangeSet, target: ReplaceTarget, oldNames: string[]): Promise<void> {
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
}
