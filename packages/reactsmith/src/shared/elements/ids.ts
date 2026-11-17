import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { exists, listFiles } from '../files.js';
import ts from 'typescript';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';
import { createContainerClassifier } from '../layout/classify.js';
import { allNodes, buildElementTree, type ElementNode, type ElementTree } from './tree.js';
import { listItemError } from './position.js';

/**
 * An element id: the file relative to srcDir and the element's path in the component,
 * "features/user-profile/components/Sidebar/Sidebar.tsx#Stack/nav/ListItem[2]".
 */
export const ID_SEPARATOR = '#';

export interface ResolvedElement {
  id: string;
  /** Project-relative path of the file, with forward slashes. */
  file: string;
  element: ElementNode;
  tree: ElementTree;
}

function idError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

function toPosix(file: string): string {
  return file.split(path.sep).join('/');
}

/** "Stack, nav[1], nav[2]", the ids to choose from. */
function choices(nodes: ElementNode[]): string {
  return nodes.length === 0 ? 'it has no elements' : `choose from: ${nodes.map((node) => node.segment).join(', ')}`;
}

/**
 * Finds the file a target points to: relative to srcDir (as in ids), to the project root, or absolute.
 * Returns it relative to srcDir and to the root.
 */
async function locateFile(root: string, config: ResolvedConfig, file: string): Promise<{ srcRel: string; rootRel: string }> {
  const srcDir = path.join(root, config.srcDir);
  const fromRoot = path.resolve(root, file);
  const inSrc = fromRoot.startsWith(srcDir + path.sep);
  const fromRootExists = await exists(fromRoot);
  const absolute = inSrc || fromRootExists ? fromRoot : path.resolve(srcDir, file);
  if (!absolute.startsWith(srcDir + path.sep)) {
    throw idError('element-file-outside-src', `"${file}" is not inside ${config.srcDir}/.`, 'Point at a component file in the source folder.');
  }
  return { srcRel: toPosix(path.relative(srcDir, absolute)), rootRel: toPosix(path.relative(root, absolute)) };
}

/**
 * The files of the source folder a path that doesn't exist may have meant: those ending with it
 * ("components/TopBar/TopBar.tsx" → "app/components/TopBar/TopBar.tsx"), else those with its file name. From srcDir, as in ids.
 */
async function filesMeant(root: string, config: ResolvedConfig, given: string): Promise<string[]> {
  const srcDir = path.join(root, config.srcDir);
  const all = (await listFiles(srcDir)).map((file) => toPosix(path.relative(srcDir, file)));
  const tail = toPosix(given).replace(/^\.?\//, '').replace(new RegExp(`^${config.srcDir}/`), '');
  const ending = all.filter((file) => file === tail || file.endsWith(`/${tail}`));
  return ending.length ? ending : all.filter((file) => path.posix.basename(file) === path.posix.basename(tail));
}

/** "src/x.tsx does not exist", with the ids it may have meant: ids start from the source folder. */
async function fileMissingError(root: string, config: ResolvedConfig, rootRel: string, given: string, elementPath?: string): Promise<IssueError> {
  const meant = await filesMeant(root, config, given);
  const id = (file: string) => (elementPath === undefined ? file : `${file}${ID_SEPARATOR}${elementPath}`);
  const hint = meant.length
    ? `Ids give the file from ${config.srcDir}/, e.g. "${id(meant[0]!)}"${meant.length > 1 ? ` (or ${meant.slice(1, 4).map((file) => `"${id(file)}"`).join(', ')})` : ''}.`
    : `Ids give the file from ${config.srcDir}/, e.g. "app/components/TopBar/TopBar.tsx#links".`;
  return idError('element-file-missing', `${rootRel} does not exist.`, hint, rootRel);
}

async function loadTree(root: string, config: ResolvedConfig, rootRel: string, given = rootRel, elementPath?: string): Promise<ElementTree> {
  const absolute = path.join(root, rootRel);
  const text = await readFile(absolute, 'utf8').catch(() => undefined);
  if (text === undefined) throw await fileMissingError(root, config, rootRel, given, elementPath);
  const sourceFile = ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const name = path.basename(absolute).replace(/\.[jt]sx?$/, '');
  const tree = buildElementTree(sourceFile, name, createContainerClassifier(sourceFile, absolute, root, config));
  if (!tree) {
    throw idError('element-component-missing', `${rootRel} has no component "${name}".`, `Elements have ids only inside a component named like its file: "export const ${name}: React.FC = () => …".`, rootRel);
  }
  return tree;
}

/** The element tree of a file given as in ids (from srcDir), from the project root, or absolute. */
export async function loadFileTree(root: string, config: ResolvedConfig, file: string): Promise<{ srcRel: string; rootRel: string; tree: ElementTree }> {
  const { srcRel, rootRel } = await locateFile(root, config, file);
  return { srcRel, rootRel, tree: await loadTree(root, config, rootRel, file) };
}

/**
 * The id of an element: its name when no other element of the file has it ("TopBar.tsx#signIn"), so it stays the
 * same when siblings come and go; otherwise its path of tags ("TopBar.tsx#header/div[2]/button[3]").
 */
export function elementId(srcRel: string, element: ElementNode, tree: ElementTree): string {
  const isUnique = (node: ElementNode) => node.name !== undefined && tree.names.get(node.name) === 1;
  if (isUnique(element)) return `${srcRel}${ID_SEPARATOR}${element.name}`;
  // Otherwise from its nearest named ancestor ("features/{CORE_FEATURES}"), so only the part below it can shift.
  const ancestor = allNodes(tree.roots)
    .filter((node) => isUnique(node) && element.path.startsWith(`${node.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const path = ancestor ? `${ancestor.name}/${element.path.slice(ancestor.path.length + 1)}` : element.path;
  return `${srcRel}${ID_SEPARATOR}${path}`;
}

/** The element an id points to: a name ("Sidebar.tsx#links"), a path ("Sidebar.tsx#Stack/nav"), or both ("…#root/links"). */
export async function resolveId(root: string, config: ResolvedConfig, id: string): Promise<ResolvedElement> {
  const at = id.indexOf(ID_SEPARATOR);
  const elementPath = id.slice(at + 1);
  const { srcRel, rootRel } = await locateFile(root, config, id.slice(0, at));
  const tree = await loadTree(root, config, rootRel, id.slice(0, at), elementPath);

  // A name alone: the element of the file that has it.
  if (!elementPath.includes('/')) {
    const named = allNodes(tree.roots).filter((node) => node.name === elementPath);
    if (named.length === 1) return { id: elementId(srcRel, named[0]!, tree), file: rootRel, element: named[0]!, tree };
    if (named.length > 1) {
      throw idError('element-name-ambiguous', `${named.length} elements of ${tree.component} are named "${elementPath}".`, `Use a path instead: ${named.map((node) => node.path).join(', ')}.`, rootRel);
    }
  }

  let siblings = tree.roots;
  let element: ElementNode | undefined;
  let parentPath = tree.component;
  const segments = elementPath.split('/');
  // A path may start from any element with a unique name: "features/{CORE_FEATURES}".
  const start = allNodes(tree.roots).filter((node) => node.name === segments[0]);
  if (start.length === 1 && segments.length > 1) {
    element = start[0]!;
    siblings = element.children;
    parentPath = `${tree.component}/${element.path}`;
    segments.shift();
  }
  for (const segment of segments) {
    // A name among the siblings wins over a tag.
    const named = siblings.filter((node) => node.name === segment);
    if (named.length === 1) {
      element = named[0]!;
      siblings = element.children;
      parentPath = `${tree.component}/${element.path}`;
      continue;
    }
    const match = /^(.+?)(?:\[(\d+)\])?$/.exec(segment);
    const tag = match?.[1] ?? segment;
    const candidates = siblings.filter((node) => node.tag === tag);
    const index = match?.[2] === undefined ? undefined : Number(match[2]);
    if (index === undefined && candidates.length > 1) {
      throw idError('element-id-ambiguous', `"${segment}" in ${parentPath} matches ${candidates.length} elements.`, `Add an index: ${candidates.map((node) => node.segment).join(', ')}.`, rootRel);
    }
    // The item of a list ("{ROWS}/ResultRow") is not an element of this file: its content goes inside the component.
    if (element?.kind === 'list' && candidates.length === 0 && element.component === tag) {
      throw listItemError(`${srcRel}${ID_SEPARATOR}${elementPath}`, tag, rootRel);
    }
    element = index === undefined ? candidates[0] : candidates[index - 1];
    if (!element) {
      throw idError('element-not-found', `No element "${segment}" in ${parentPath}.`, `The code may have changed: ${choices(siblings)}.`, rootRel);
    }
    siblings = element.children;
    parentPath = `${tree.component}/${element.path}`;
  }
  return { id: elementId(srcRel, element!, tree), file: rootRel, element: element!, tree };
}

/**
 * The element at a line of a file, and the column when several elements start on that line.
 * Without a column it is the element starting on the line or, if none does, the innermost one containing it.
 */
export async function locateElement(root: string, config: ResolvedConfig, file: string, line: number, column?: number): Promise<ResolvedElement> {
  const { srcRel, rootRel } = await locateFile(root, config, file);
  const tree = await loadTree(root, config, rootRel);
  const elements = allNodes(tree.roots).filter((node) => node.kind !== 'slot');
  const contains = (node: ElementNode, col: number) =>
    (node.start.line < line || (node.start.line === line && node.start.column <= col)) &&
    (node.end.line > line || (node.end.line === line && node.end.column > col));

  let matches = column === undefined ? elements.filter((node) => node.start.line === line) : [];
  if (matches.length === 0) {
    // Innermost: allNodes lists parents first, so the last match is the deepest.
    const containing = elements.filter((node) => contains(node, column ?? Number.MAX_SAFE_INTEGER) && (column !== undefined || node.start.line <= line));
    matches = containing.slice(-1);
  }
  if (matches.length === 0) {
    throw idError('element-not-found', `No element at ${rootRel}:${line}${column === undefined ? '' : `:${column}`}.`, 'Point at a line where a JSX element of the component starts.', rootRel);
  }
  if (matches.length > 1) {
    const list = matches.map((node) => `${node.start.column} (${node.path})`).join(', ');
    throw idError('element-line-ambiguous', `${matches.length} elements start on ${rootRel}:${line}.`, `Add the column: ${list}.`, rootRel);
  }
  const element = matches[0]!;
  return { id: elementId(srcRel, element, tree), file: rootRel, element, tree };
}

/** An id, or a "file:line" / "file:line:column" location. */
export async function resolveTarget(root: string, config: ResolvedConfig, target: string): Promise<ResolvedElement> {
  if (target.includes(ID_SEPARATOR)) return resolveId(root, config, target);
  const match = /^(.+?):(\d+)(?::(\d+))?$/.exec(target);
  if (!match) {
    throw idError('element-target-invalid', `"${target}" is neither an element id nor a file location.`, 'Use "path/to/File.tsx:line", "path/to/File.tsx:line:column" or an id such as "features/docs/components/Sidebar/Sidebar.tsx#Stack/nav".');
  }
  return locateElement(root, config, match[1]!, Number(match[2]), match[3] === undefined ? undefined : Number(match[3]));
}
