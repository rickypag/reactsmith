import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import { addImport } from '../code/insert.js';
import { isStillUsed, removeImport } from '../code/remove.js';
import { parseAttributes } from '../elements/props.js';
import { componentFunction } from '../elements/tree.js';
import { listFiles, toRelative } from '../files.js';
import { knownTypes, typeImports } from '../imports/types.js';
import { findTypeSources } from '../imports/lookup.js';
import { IssueError, type Issue } from '../issues.js';
import { planMakeStyleable, STYLEABLE_INTERFACE, styleableProp } from '../styles/styleable.js';
import { typeErrorsIn } from '../types/check.js';
import { applyNames, destructureProps } from '../values/scope.js';
import { propTargets } from '../values/placeholders.js';
import { availableConstants } from '../constants/files.js';
import { planComponentMove } from './move.js';
import { interfaceMember, parseProps } from './props.js';
import type { ComponentOwner } from './scope.js';
import { projectComponents, type ProjectComponent } from './registry.js';
import { applyEdits, componentUsages, openingOf, parseTsx, usageElements } from './usages.js';

export interface ComponentUpdateOptions {
  /** The component: its name ("Card"), or its folder ("src/components/cards/Card"). */
  target: string;
  /** A new name: renames the folder, the files, the code and every usage. */
  name?: string;
  /** Props to add, or to change when they exist, as interface members: "size?: 'sm' | 'lg'". */
  interface?: string;
  /** Props to remove, by name: refused while the component or a usage still uses them. */
  removeInterface?: string;
  /** Props to rename, "old=new": in the interface, the component and every usage. */
  renameInterface?: string;
  /** The value existing usages get for a new required prop, as in JSX: "'md'" or "{2}". */
  default?: string;
  /** Another owner to move it to, with the components only it uses. */
  moveTo?: ComponentOwner;
}

export interface ComponentUpdateResult {
  name: string;
  /** The component's folder after the update, relative to the root. */
  folder: string;
  warnings: Issue[];
}

function updateError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** The component a target names: a name (unique in the project), or a folder path, relative to the root or to srcDir. */
export async function resolveComponent(root: string, config: ResolvedConfig, target: string): Promise<ProjectComponent> {
  const layouts = [config.appFolders.layouts, config.featureFolders.layouts].filter(Boolean).map((folder) => `/${folder}/`);
  const all = (await projectComponents(root, config)).filter((component) => !layouts.some((folder) => component.folderRel.includes(folder)));
  const given = target.replace(/\\/g, '/').replace(/\/+$/, '');
  const asPath = given.includes('/') ? (given.startsWith(`${config.srcDir}/`) ? given : `${config.srcDir}/${given}`) : undefined;
  const matches = asPath ? all.filter((component) => component.folderRel === asPath) : all.filter((component) => component.name === given);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw updateError('component-ambiguous', `"${target}" names ${matches.length} components.`, `Pass its folder instead: ${matches.map((component) => component.folderRel).join(', ')}.`);
  }
  throw updateError('component-missing', `There is no component "${target}".`, 'Pass a component name, e.g. Card, or its folder, e.g. src/components/cards/Card.');
}

/** The files of a component folder, relative to the root, including subfolders such as api/. */
async function folderFiles(root: string, folderRel: string): Promise<string[]> {
  return (await listFiles(path.join(root, folderRel)).catch(() => [])).map((file) => toRelative(root, file));
}

/** Renames the identifiers and the local import paths of a component's own code: Card, CardProps, CardContent, './Card.module.css'. */
function renameInCode(fileRel: string, text: string, from: string, to: string): string {
  const own = new RegExp(`^${from}(Content|Skeleton)?(Props)?$`);
  const local = new RegExp(`^\\./${from}((Content|Skeleton)?(\\.module\\.css|\\.styles)?)?$`);
  const sourceFile = parseTsx(fileRel, text);
  const edits: [number, number, string][] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && own.test(node.text)) edits.push([node.getStart(sourceFile), node.getEnd(), node.text.replace(from, to)]);
    if (ts.isStringLiteral(node) && local.test(node.text) && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent))) {
      edits.push([node.getStart(sourceFile) + 1, node.getEnd() - 1, node.text.replace(from, to)]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return applyEdits(text, edits);
}

/**
 * Plans renaming a component: its folder and files (Card.tsx, CardContent.tsx, Card.module.css…), its code (Card,
 * CardProps…), its shared type's barrel, and every usage: import paths, imported names and JSX tags.
 */
async function planRename(changes: ChangeSet, config: ResolvedConfig, component: ProjectComponent, to: string): Promise<ProjectComponent> {
  const from = component.name;
  if (!/^[A-Z][A-Za-z0-9]*$/.test(to)) throw updateError('component-name-invalid', `"${to}" is not a valid component name.`, 'Use a PascalCase name like "ProfileCard".');
  const taken = (await projectComponents(changes.root, config)).find((other) => other.name === to);
  if (taken) throw updateError('component-name-taken', `"${to}" already exists in ${taken.folderRel}.`, 'Component names are unique in the project: choose another name.', taken.folderRel);

  // Usages first, while the files still have their old names.
  const usages = await componentUsages(changes, config, from, component.folderRel);
  const folderRel = `${path.posix.dirname(component.folderRel)}/${to}`;

  for (const fileRel of await folderFiles(changes.root, component.folderRel)) {
    const inner = fileRel.slice(component.folderRel.length + 1);
    const renamed = inner.includes('/') ? inner : inner.replace(new RegExp(`^${from}(?=(Content|Skeleton)?\\.)`), to);
    const target = `${folderRel}/${renamed}`;
    const text = (await changes.read(fileRel)) ?? '';
    changes.move({ from: changes.resolve(fileRel), to: changes.resolve(target) });
    if (/\.[jt]sx?$/.test(fileRel)) changes.writeSilently(changes.resolve(target), renameInCode(target, text, from, to));
  }
  changes.removeIfEmpty(changes.resolve(component.folderRel));

  // The barrel of a shared type offers it under its name.
  const barrelRel = `${path.posix.dirname(component.folderRel)}/index.ts`;
  const isShared = !!config.folders.components && component.folderRel.startsWith(`${config.srcDir}/${config.folders.components}/`);
  const barrel = isShared ? await changes.read(barrelRel) : undefined;
  if (barrel !== undefined) changes.write(barrelRel, renameInCode(barrelRel, barrel, from, to), { type: 'update', message: `"${from}" is now "${to}"` });

  for (const usage of usages) {
    const text = (await changes.read(usage.fileRel))!;
    const sourceFile = parseTsx(usage.fileRel, text);
    const edits: [number, number, string][] = [];
    const visit = (node: ts.Node): void => {
      // The import path, when it points at the component's folder: "../Card" → "../ProfileCard".
      if (ts.isStringLiteral(node) && ts.isImportDeclaration(node.parent) && node.text === usage.specifier && node.text.split('/').pop() === from) {
        edits.push([node.getStart(sourceFile) + 1, node.getEnd() - 1, `${node.text.slice(0, -from.length)}${to}`]);
      }
      // The imported name and, unless the import renames it, the JSX tags and the props type.
      if (ts.isIdentifier(node) && (node.text === from || node.text === `${from}Props`)) {
        const isImported = ts.isImportSpecifier(node.parent) && (node.parent.propertyName === node || (!node.parent.propertyName && node.parent.name === node));
        if (isImported || !usage.aliased) edits.push([node.getStart(sourceFile), node.getEnd(), node.text.replace(from, to)]);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    changes.write(usage.fileRel, applyEdits(text, edits), { type: 'update', message: `"${from}" is now "${to}"` });
  }
  changes.report({ type: 'move', path: component.folderRel, message: `→ ${folderRel}` });
  return { name: to, folderRel };
}

/** The props interface of a component and its function, in the component's file. */
function componentParts(fileRel: string, text: string, name: string) {
  const sourceFile = parseTsx(fileRel, text);
  const declaration = sourceFile.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === `${name}Props`);
  return { sourceFile, declaration, fn: componentFunction(sourceFile, name) };
}

/** The variable a component is declared with, `export const Card: React.FC<CardProps> = …`, and its statement. */
function componentVariable(fn: ts.Node | undefined): { variable: ts.VariableDeclaration; statement: ts.VariableStatement } | undefined {
  let node = fn;
  while (node && !ts.isVariableDeclaration(node)) node = node.parent;
  const statement = node?.parent?.parent;
  return node && statement && ts.isVariableStatement(statement) ? { variable: node as ts.VariableDeclaration, statement } : undefined;
}

/** A shared component's type barrel, src/components/<type>/index.ts, or undefined for app and feature components. */
function typeBarrel(config: ResolvedConfig, folderRel: string): string | undefined {
  const isShared = !!config.folders.components && folderRel.startsWith(`${config.srcDir}/${config.folders.components}/`);
  return isShared ? `${path.posix.dirname(folderRel)}/index.ts` : undefined;
}

/** Adds an empty props interface to a component without one, and types the component with it: React.FC → React.FC<CardProps>. */
function addPropsInterface(fileRel: string, text: string, name: string): string {
  const { sourceFile, fn } = componentParts(fileRel, text, name);
  const declared = componentVariable(fn);
  const type = declared?.variable.type;
  // A styleable component without props is typed React.FC<StyleableProps>: its interface extends that.
  const styleable = type && ts.isTypeReferenceNode(type) && type.typeArguments?.length === 1 && type.typeArguments[0]!.getText(sourceFile) === STYLEABLE_INTERFACE;
  if (!declared || !type || !ts.isTypeReferenceNode(type) || (type.typeArguments && !styleable) || !/^(React\.)?(FC|FunctionComponent)$/.test(type.typeName.getText(sourceFile))) {
    throw updateError('props-interface-missing', `"${name}" has no ${name}Props interface, and isn't typed as React.FC to add one.`, `Type it as React.FC<${name}Props> with export interface ${name}Props { … }, then add props.`, fileRel);
  }
  const at = declared.statement.getStart(sourceFile, true);
  return applyEdits(text, [
    [type.typeName.getEnd(), type.getEnd(), `<${name}Props>`],
    [at, at, `export interface ${name}Props${styleable ? ` extends ${STYLEABLE_INTERFACE}` : ''} {\n}\n\n`],
  ]);
}

/** Removes the props interface of a component, and its type from the component: React.FC<CardProps> → React.FC. */
function removePropsInterface(fileRel: string, text: string, name: string): string {
  const { sourceFile, declaration, fn } = componentParts(fileRel, text, name);
  const type = componentVariable(fn)?.variable.type;
  const edits: [number, number, string][] = [];
  if (type && ts.isTypeReferenceNode(type) && type.typeArguments?.length === 1 && type.typeArguments[0]!.getText(sourceFile) === `${name}Props`) {
    edits.push([type.typeName.getEnd(), type.getEnd(), '']);
  }
  // Extending only StyleableProps, the component keeps taking a class: React.FC<StyleableProps>.
  const styleable = declaration!.heritageClauses?.length === 1 && declaration!.heritageClauses[0]!.types.length === 1 && declaration!.heritageClauses[0]!.types[0]!.getText(sourceFile) === STYLEABLE_INTERFACE;
  if (styleable && edits.length) edits[0]![2] = `<${STYLEABLE_INTERFACE}>`;
  const end = declaration!.getEnd();
  edits.push([declaration!.getStart(sourceFile, true), end + /^\s*/.exec(text.slice(end))![0].length, '']);
  return applyEdits(text, edits);
}

/** Adds or removes `export type { CardProps } from './Card';` next to the component's export, in its entry point and its type barrel. */
async function planPropsTypeExport(changes: ChangeSet, config: ResolvedConfig, component: ProjectComponent, mode: 'add' | 'remove'): Promise<void> {
  const { name, folderRel } = component;
  const valueLine = `export { ${name} } from './${name}';`;
  const typeLine = `export type { ${name}Props } from './${name}';`;
  for (const fileRel of [`${folderRel}/index.ts`, typeBarrel(config, folderRel)]) {
    const text = fileRel && (await changes.read(fileRel));
    if (!fileRel || text === undefined) continue;
    const lines = text.split('\n');
    const at = lines.indexOf(mode === 'add' ? valueLine : typeLine);
    if (at === -1 || (mode === 'add' && lines.includes(typeLine))) continue;
    if (mode === 'add') lines.splice(at + 1, 0, typeLine);
    else lines.splice(at, 1);
    changes.write(fileRel, lines.join('\n'), { type: 'update', message: mode === 'add' ? `exports ${name}Props` : `no longer exports ${name}Props` });
  }
}

/** The project files, other than the component's own file and its exports, that name its props type. */
async function propsTypeUsers(changes: ChangeSet, config: ResolvedConfig, component: ProjectComponent): Promise<string[]> {
  const { name, folderRel } = component;
  const own = new Set([`${folderRel}/${name}.tsx`, `${folderRel}/index.ts`, typeBarrel(config, folderRel)]);
  const pattern = new RegExp(`\\b${name}Props\\b`);
  const users: string[] = [];
  for (const file of await listFiles(changes.resolve(config.srcDir)).catch(() => [])) {
    const fileRel = toRelative(changes.root, file);
    if (!/\.tsx?$/.test(fileRel) || own.has(fileRel)) continue;
    if (pattern.test((await changes.read(fileRel)) ?? '')) users.push(fileRel);
  }
  return users;
}

/** Gives a destructured prop its default, changes it, or takes it away: `({ showName })` → `({ showName = true })`. */
function setDestructuredDefault(fileRel: string, text: string, name: string, prop: string, value: string | undefined): string {
  const { sourceFile, fn } = componentParts(fileRel, text, name);
  const parameter = fn?.parameters[0];
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return text;
  const element = parameter.name.elements.find((candidate) => !candidate.dotDotDotToken && (candidate.propertyName ?? candidate.name).getText(sourceFile) === prop);
  if (!element) return text;
  if (value === undefined) return element.initializer ? applyEdits(text, [[element.name.getEnd(), element.initializer.getEnd(), '']]) : text;
  if (element.initializer) return applyEdits(text, [[element.initializer.getStart(sourceFile), element.initializer.getEnd(), value]]);
  return applyEdits(text, [[element.name.getEnd(), element.name.getEnd(), ` = ${value}`]]);
}

/** The identifiers of a component's body that read a prop, not counting where the props are destructured. */
function propReads(fn: ts.ArrowFunction, prop: string): ts.Identifier[] {
  const reads: ts.Identifier[] = [];
  const parameter = fn.parameters[0];
  const viaParameter = parameter && ts.isIdentifier(parameter.name) ? parameter.name.text : undefined;
  const visit = (node: ts.Node): void => {
    if (node === parameter) return;
    if (ts.isIdentifier(node) && node.text === prop) {
      const parent = node.parent;
      const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node && !(viaParameter && ts.isIdentifier(parent.expression) && parent.expression.text === viaParameter)) ||
        ts.isJsxAttribute(parent) || (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!isPropertyName) reads.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return reads;
}

/**
 * Replaces the placeholders of `types` that the project now has: a type that didn't exist when the component was
 * created (`export type NavItem = unknown;` in its types.ts) is imported from where it is found, as for a new prop,
 * and its placeholder goes, with types.ts when it holds no other. Returns the component's text.
 */
async function replacePlaceholders(changes: ChangeSet, config: ResolvedConfig, component: ProjectComponent, fileRel: string, text: string, types: string[]): Promise<string> {
  const typesRel = `${component.folderRel}/types.ts`;
  const typesText = await changes.read(typesRel);
  if (typesText === undefined) return text;
  const placeholder = (type: string) => new RegExp(`^export type ${type} = unknown;\\r?\\n?`, 'm');
  const candidates = types.filter((type) => placeholder(type).test(typesText));
  if (candidates.length === 0) return text;
  // Looked up as if the component didn't import them: from its own types.ts, they would be found again.
  const sourceFile = parseTsx(fileRel, text);
  const local = sourceFile.statements.find((statement): statement is ts.ImportDeclaration => ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === './types');
  const sources = await findTypeSources(changes, config, fileRel, '', candidates);
  const found = candidates.filter((type) => sources.found.has(type) && sources.found.get(type) !== './types');
  if (found.length === 0) return text;

  let updated = text;
  const bindings = local?.importClause?.namedBindings;
  if (local && bindings && ts.isNamedImports(bindings)) {
    const kept = bindings.elements.filter((element) => !found.includes(element.name.text)).map((element) => element.getText(sourceFile));
    const end = local.getEnd() + (/^\r?\n/.exec(text.slice(local.getEnd()))?.[0].length ?? 0);
    updated = kept.length ? applyEdits(text, [[bindings.getStart(sourceFile), bindings.getEnd(), `{ ${kept.join(', ')} }`]]) : applyEdits(text, [[local.getStart(sourceFile), end, '']]);
  }
  for (const statement of typeImports(new Map(found.map((type) => [type, sources.found.get(type)!])))) updated = addImport(updated, parseTsx(fileRel, updated), statement);

  const rest = found.reduce((remaining, type) => remaining.replace(placeholder(type), ''), typesText);
  if (/^export /m.test(rest)) changes.write(typesRel, rest, { type: 'update', message: `placeholder ${found.join(', ')} replaced by the real type` });
  else changes.delete(typesRel, `placeholder ${found.join(', ')} replaced by the real type`);
  return updated;
}

/** Plans the interface operations on a component: set (add or change) members, remove members, rename members. */
async function planInterface(changes: ChangeSet, config: ResolvedConfig, component: ProjectComponent, options: ComponentUpdateOptions): Promise<Issue[]> {
  const { name, folderRel } = component;
  const fileRel = `${folderRel}/${name}.tsx`;
  let text = (await changes.read(fileRel))!;
  const usages = await componentUsages(changes, config, name, folderRel);
  const usageTexts = new Map<string, string>();
  for (const usage of usages) usageTexts.set(usage.fileRel, (await changes.read(usage.fileRel))!);
  /** Every usage element, with its file: what the props of the component are given by. */
  const eachUsage = (fn: (usage: (typeof usages)[number], sourceFile: ts.SourceFile, element: ts.JsxElement | ts.JsxSelfClosingElement) => [number, number, string][] | void) => {
    for (const usage of usages) {
      const sourceFile = parseTsx(usage.fileRel, usageTexts.get(usage.fileRel)!);
      const edits = usageElements(sourceFile, usage.localName).flatMap((element) => fn(usage, sourceFile, element) ?? []);
      if (edits.length) usageTexts.set(usage.fileRel, applyEdits(usageTexts.get(usage.fileRel)!, edits));
    }
  };
  const attributeOf = (sourceFile: ts.SourceFile, element: ts.JsxElement | ts.JsxSelfClosingElement, prop: string) =>
    openingOf(element).attributes.properties.find((attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === prop);
  const warnings: Issue[] = [];
  /** A usage element, by its file and its place among the file's usages: stable while attributes are added. */
  const usageKey = (usage: (typeof usages)[number], sourceFile: ts.SourceFile, element: ts.JsxElement | ts.JsxSelfClosingElement) =>
    `${usage.fileRel}#${usageElements(sourceFile, usage.localName).indexOf(element)}`;
  /** The required props this change adds, with their types: what each usage must now give. */
  const requiredProps: { prop: string; type: string }[] = [];
  // The names in the types of removed or replaced props: their imports go when nothing else uses them.
  const droppedNames = new Set<string>();
  const dropNamesOf = (member: ts.TypeElement) => {
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) droppedNames.add(node.text);
      ts.forEachChild(node, visit);
    };
    if (ts.isPropertySignature(member) && member.type) visit(member.type);
    else if (!ts.isPropertySignature(member)) visit(member);
  };

  /**
   * Gives usage elements the new prop, with --default as its value, after their other props. The variables of the
   * value must exist where each usage is, as for any prop given (see resolveNames): else a placeholder or a refusal.
   */
  const giveDefault = async (prop: string, type: string, keys: Set<string>) => {
    const parsedDefault = parseAttributes(`${prop}=${options.default}`, name);
    const value = parsedDefault.attributes[0]!.text;
    const files = new Set<string>();
    eachUsage((usage, usageFile, element) => {
      if (!keys.has(usageKey(usage, usageFile, element))) return undefined;
      files.add(usage.fileRel);
      const opening = openingOf(element);
      const at = opening.attributes.properties.length ? opening.attributes.properties[opening.attributes.properties.length - 1]!.getEnd() : opening.tagName.getEnd();
      return [[at, at, ` ${value}`]];
    });
    if (parsedDefault.names.length === 0) return;
    for (const usageRel of files) {
      const usage = usages.find((candidate) => candidate.fileRel === usageRel)!;
      const parent = path.basename(usageRel).replace(/\.tsx?$/, '');
      const usageText = usageTexts.get(usageRel)!;
      if (!componentFunction(parseTsx(usageRel, usageText), parent)) {
        throw updateError('value-name-unknown', `The default ${value} uses ${parsedDefault.names.map((variable) => `"${variable}"`).join(', ')}, but ${usageRel} has no component ${parent} to take ${parsedDefault.names.length === 1 ? 'it' : 'them'} from.`, `Give a literal with --default, e.g. --default "'md'", or add the prop to that usage by hand.`, usageRel);
      }
      const targets = propTargets(parsedDefault, usage.localName, new Map([[prop, type]]));
      usageTexts.set(usageRel, applyNames(usageText, usageRel, parent, parsedDefault.names, { constants: await availableConstants(changes, config, usageRel), propTargets: targets, warnings }));
    }
  };

  // Rename: interface, body, usages. Refused for usages that pass props through a spread: their data has the old name.
  for (const pair of (options.renameInterface ?? '').split(/[\s,]+/).filter(Boolean)) {
    const [old, next] = pair.split('=');
    if (!old || !next || !/^[A-Za-z_$][\w$]*$/.test(next)) throw updateError('interface-rename-invalid', `"${pair}" is not a rename.`, 'Write it as old=new, e.g. --rename-interface "label=title".', fileRel);
    const { sourceFile, declaration, fn } = componentParts(fileRel, text, name);
    const member = declaration?.members.find((candidate) => candidate.name?.getText(sourceFile) === old);
    if (!member || !fn) throw updateError('prop-missing', `"${name}" has no prop "${old}".`, 'Check the name in its interface.', fileRel);
    if (declaration!.members.some((candidate) => candidate.name?.getText(sourceFile) === next)) throw updateError('prop-exists', `"${name}" already has a prop "${next}".`, 'Choose another name.', fileRel);
    const spreads: string[] = [];
    eachUsage((usage, usageFile, element) => {
      const attribute = attributeOf(usageFile, element, old);
      if (attribute) return [[attribute.name.getStart(usageFile), attribute.name.getEnd(), next]];
      if (openingOf(element).attributes.properties.some((property) => ts.isJsxSpreadAttribute(property))) spreads.push(usage.fileRel);
      return undefined;
    });
    if (spreads.length) {
      throw updateError('prop-rename-spread', `"${old}" may come through a spread in ${[...new Set(spreads)].join(', ')}.`, `Rename it in the data the spread passes first (e.g. its constant), or pass it explicitly as ${old}={…}.`, fileRel);
    }
    const edits: [number, number, string][] = [[member.name!.getStart(sourceFile), member.name!.getEnd(), next]];
    const parameter = fn.parameters[0];
    if (parameter && ts.isObjectBindingPattern(parameter.name)) {
      const binding = parameter.name.elements.find((element) => (element.propertyName ?? element.name).getText(sourceFile) === old);
      if (binding && !binding.propertyName) edits.push([binding.name.getStart(sourceFile), binding.name.getEnd(), next]);
      if (binding?.propertyName) edits.push([binding.propertyName.getStart(sourceFile), binding.propertyName.getEnd(), next]);
      else for (const read of propReads(fn, old)) edits.push([read.getStart(sourceFile), read.getEnd(), next]);
    } else if (parameter && ts.isIdentifier(parameter.name)) {
      const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === (parameter.name as ts.Identifier).text && node.name.text === old) {
          edits.push([node.name.getStart(sourceFile), node.name.getEnd(), next]);
        }
        ts.forEachChild(node, visit);
      };
      visit(fn.body);
    }
    text = applyEdits(text, edits);
  }

  // Remove: refused while the component or a usage still uses the prop.
  for (const prop of (options.removeInterface ?? '').split(/[\s,]+/).filter(Boolean)) {
    const { sourceFile, declaration, fn } = componentParts(fileRel, text, name);
    const member = declaration?.members.find((candidate) => candidate.name?.getText(sourceFile) === prop);
    if (!member || !fn) throw updateError('prop-missing', `"${name}" has no prop "${prop}".`, 'Check the name in its interface.', fileRel);
    if (propReads(fn, prop).length) {
      throw updateError('prop-in-use', `"${name}" still uses "${prop}" in its code.`, `Remove what uses it from ${name}.tsx first: its interface follows its code, not the other way round.`, fileRel);
    }
    const users: string[] = [];
    eachUsage((usage, usageFile, element) => {
      if (attributeOf(usageFile, element, prop)) users.push(usage.fileRel);
    });
    if (users.length) {
      throw updateError('prop-in-use', `"${prop}" is still given to ${name} in ${[...new Set(users)].join(', ')}.`, `Remove it there first: "element update <element> --remove-props ${prop}".`, fileRel);
    }
    dropNamesOf(member);
    const edits: [number, number, string][] = [[member.getFullStart(), member.getEnd(), '']];
    const parameter = fn.parameters[0];
    if (parameter && ts.isObjectBindingPattern(parameter.name)) {
      const elements = parameter.name.elements;
      const index = elements.findIndex((element) => (element.propertyName ?? element.name).getText(sourceFile) === prop);
      if (index !== -1) {
        const element = elements[index]!;
        // "a, label" → "a", "label, b" → "b", "label" → "" (and the empty pattern goes).
        if (elements.length === 1) edits.push([parameter.getStart(sourceFile), parameter.getEnd(), '']);
        else if (index === elements.length - 1) edits.push([elements[index - 1]!.getEnd(), element.getEnd(), '']);
        else edits.push([element.getStart(sourceFile), elements[index + 1]!.getStart(sourceFile), '']);
      }
    }
    text = applyEdits(text, edits);
  }

  // Set: add members, or replace those with the same name. A new required prop needs a value in existing usages.
  if (options.interface?.trim()) {
    const parsed = parseProps(options.interface);
    text = await replacePlaceholders(changes, config, component, fileRel, text, parsed.unknownTypes);
    // Types the file imports or declares are known; the others are imported from where they are found, as components are.
    const known = knownTypes(text);
    const missingTypes = parsed.unknownTypes.filter((type) => !known.has(type));
    const sources = await findTypeSources(changes, config, fileRel, text, missingTypes);
    const unresolved = missingTypes.filter((type) => !sources.found.has(type));
    if (unresolved.length) {
      const ambiguous = unresolved.filter((type) => sources.ambiguous.has(type)).map((type) => ` "${type}" is in ${sources.ambiguous.get(type)!.join(' and ')}.`).join('');
      throw updateError('props-type-unknown', `${unresolved.map((type) => `"${type}"`).join(', ')} ${unresolved.length === 1 ? 'is' : 'are'} not a type the component knows.${ambiguous}`, `Import or declare it in ${name}.tsx (or its types.ts) first, then add the prop.`, fileRel);
    }
    for (const statement of typeImports(sources.found)) text = addImport(text, parseTsx(fileRel, text), statement);
    // A component without props gets its interface with the first one.
    if (!componentParts(fileRel, text, name).declaration) {
      text = addPropsInterface(fileRel, text, name);
      await planPropsTypeExport(changes, config, component, 'add');
    }
    const members = parsed.members.map((member) => member.replace(/^children\s*:/, 'children?:'));
    for (const member of members) {
      const prop = member.match(/^([A-Za-z_$][\w$]*)/)![1]!;
      const required = !/^[A-Za-z_$][\w$]*\?/.test(member);
      const defaultValue = parsed.defaults[prop];
      const { sourceFile, declaration } = componentParts(fileRel, text, name);
      const existing = declaration!.members.find((candidate) => candidate.name?.getText(sourceFile) === prop);
      if (required) {
        const type = /^[A-Za-z_$][\w$]*\??\s*:\s*([\s\S]+?);?\s*$/.exec(member)?.[1] ?? 'unknown';
        // Only a new prop goes inline next to a spread: a changed one would override what the data gives.
        if (!existing) requiredProps.push({ prop, type });
        // The usages that don't give the prop. Those with a spread are left to TypeScript, below: the spread may give it.
        const missing = new Set<string>();
        const missingFiles = new Set<string>();
        eachUsage((usage, usageFile, element) => {
          const hasSpread = openingOf(element).attributes.properties.some((property) => ts.isJsxSpreadAttribute(property));
          if (attributeOf(usageFile, element, prop) || hasSpread) return undefined;
          missing.add(usageKey(usage, usageFile, element));
          missingFiles.add(usage.fileRel);
          return undefined;
        });
        if (missing.size && options.default === undefined) {
          throw updateError(
            'props-required-usages',
            `"${prop}" would be required, but ${missing.size} usage${missing.size === 1 ? '' : 's'} of ${name} don't give it (${[...missingFiles].join(', ')}).`,
            defaultHint(prop, type),
            fileRel,
          );
        }
        if (missing.size) await giveDefault(prop, type, missing);
      }
      // The member as written: a change without a default takes the old default away.
      const written = interfaceMember(member, defaultValue);
      if (existing) {
        dropNamesOf(existing);
        text = applyEdits(text, [[existing.getStart(sourceFile, true), existing.getEnd(), written.trimStart()]]);
      } else {
        const close = declaration!.getEnd() - 1;
        const body = text.slice(declaration!.members.pos, close);
        text = body.trim() === ''
          ? `${text.slice(0, declaration!.members.pos)}\n${written}\n${text.slice(close)}`
          : `${text.slice(0, close).replace(/\s*$/, '')}\n${written}\n${text.slice(close)}`;
      }
      // A prop the component already destructures gets its default there; the others get it when first used.
      text = setDestructuredDefault(fileRel, text, name, prop, defaultValue);
      // A component that now takes children renders them in its root, if the root has nothing yet.
      if (prop === 'children') {
        const parts = componentParts(fileRel, text, name);
        let rootNode: ts.Node | undefined = parts.fn && (ts.isBlock(parts.fn.body) ? parts.fn.body.statements.find(ts.isReturnStatement)?.expression : parts.fn.body);
        while (rootNode && ts.isParenthesizedExpression(rootNode)) rootNode = rootNode.expression;
        if (rootNode && ts.isJsxSelfClosingElement(rootNode)) {
          const opening = text.slice(rootNode.getStart(parts.sourceFile), rootNode.getEnd()).replace(/\s*\/>$/, '>');
          text = `${text.slice(0, rootNode.getStart(parts.sourceFile))}${opening}{children}</${rootNode.tagName.getText(parts.sourceFile)}>${text.slice(rootNode.getEnd())}`;
          text = destructureProps(text, fileRel, name, ['children']);
        } else if (!/\{children\}/.test(text)) {
          warnings.push({ severity: 'warning', code: 'children-not-rendered', path: fileRel, message: `"${name}" now takes children but doesn't render them yet.`, hint: 'Render {children} where its content goes.' });
        }
      }
    }
  }

  // Usages that pass props through a spread (a list's items: {...product}) can't be read: TypeScript says whether the
  // spread still gives what the props need. When it doesn't, each new required prop it lacks goes inline, with
  // --default, as for any usage; whatever still doesn't fit is refused.
  if (options.interface?.trim()) {
    const spreadErrors = (usage: (typeof usages)[number]) => {
      const usageText = usageTexts.get(usage.fileRel)!;
      const pending = new Map([[fileRel, text], ...usageTexts]);
      const sourceFile = parseTsx(usage.fileRel, usageText);
      return usageElements(sourceFile, usage.localName).flatMap((element) => {
        if (!openingOf(element).attributes.properties.some((property) => ts.isJsxSpreadAttribute(property))) return [];
        const errors = typeErrorsIn(changes.root, usage.fileRel, usageText, element.getStart(sourceFile), element.getEnd(), pending);
        return errors?.length ? [{ key: usageKey(usage, sourceFile, element), sourceFile, element, errors }] : [];
      });
    };
    const refuse = (usage: (typeof usages)[number], message: string) =>
      updateError(
        'props-spread-incompatible',
        `After this change, the data spread into <${usage.localName}> in ${usage.fileRel} would not fit: ${message}`,
        options.default === undefined
          ? 'Give the usages a value with --default (it goes next to the spread), change the data the spread passes, or add the prop as optional.'
          : 'Change the data the spread passes first, or add the prop as optional.',
        usage.fileRel,
      );
    const inline = new Map<string, Set<string>>();
    for (const usage of usages) {
      for (const { key, sourceFile, element, errors } of spreadErrors(usage)) {
        const absent = requiredProps.filter(({ prop }) => !attributeOf(sourceFile, element, prop));
        if (absent.length === 0 || options.default === undefined) throw refuse(usage, errors[0]!.message);
        for (const { prop } of absent) inline.set(prop, (inline.get(prop) ?? new Set()).add(key));
      }
    }
    for (const { prop, type } of requiredProps) if (inline.has(prop)) await giveDefault(prop, type, inline.get(prop)!);
    if (inline.size) {
      for (const usage of usages) {
        const still = spreadErrors(usage)[0];
        if (still) throw refuse(usage, still.errors[0]!.message);
      }
    }
  }

  // A component whose last prop was removed loses its interface too, unless other files name the type.
  const after = componentParts(fileRel, text, name).declaration;
  // One that only extends StyleableProps goes too: the component is then typed React.FC<StyleableProps>.
  const onlyStyleable = (declaration: ts.InterfaceDeclaration) => declaration.heritageClauses?.every((clause) => clause.types.every((type) => type.expression.getText() === STYLEABLE_INTERFACE)) ?? true;
  if (options.removeInterface?.trim() && after && after.members.length === 0 && onlyStyleable(after)) {
    const users = await propsTypeUsers(changes, config, component);
    if (users.length) {
      warnings.push({ severity: 'warning', code: 'props-interface-kept', path: fileRel, message: `${name}Props has no props left, but ${users.join(', ')} still name${users.length === 1 ? 's' : ''} it.`, hint: `Remove ${name}Props there, then run the update again or delete the empty interface.` });
    } else {
      text = removePropsInterface(fileRel, text, name);
      await planPropsTypeExport(changes, config, component, 'remove');
    }
  }

  for (const dropped of droppedNames) if (!isStillUsed(text, dropped)) text = removeImport(text, dropped);
  changes.write(fileRel, text, { type: 'update', message: `updated the props of "${name}"` });
  for (const [usageRel, usageText] of usageTexts) {
    if (usageText !== (await changes.read(usageRel))) changes.write(usageRel, usageText, { type: 'update', message: `updated the usages of "${name}"` });
  }
  return warnings;
}


/**
 * Plans updating a component: its name or its owner (a move), then its interface (set, remove and rename props), as
 * one change. Each change keeps the structure valid and updates every usage; none of them changes logic.
 */
export async function planComponentUpdate(changes: ChangeSet, config: ResolvedConfig, given: ComponentUpdateOptions): Promise<ComponentUpdateResult> {
  // "scores={[]}" is read as the value "{[]}": the prop is the one of --interface.
  const options = given.default === undefined ? given : { ...given, default: given.default.replace(/^\s*[A-Za-z_$][\w$]*\s*=(?=\s*[{'"])/, '') };
  const hasInterface = [options.interface, options.removeInterface, options.renameInterface].some((value) => value !== undefined);
  if (options.name === undefined && options.moveTo === undefined && !hasInterface) {
    throw updateError('component-update-nothing', 'Nothing to update.', 'Pass --name, --feature, --app, --type, --interface, --remove-interface or --rename-interface.');
  }
  if (options.default !== undefined && options.interface === undefined) {
    throw updateError('options-conflict', '--default gives a value to a new prop: it needs --interface.', 'E.g. --interface "size: Size" --default "\'md\'".');
  }
  if (options.default !== undefined && /=>|\bfunction\b/.test(options.default)) {
    const prop = /^\s*([A-Za-z_$][\w$]*)/.exec(options.interface ?? '')?.[1] ?? 'onChange';
    throw updateError('default-function', `--default "${options.default}" is a function: a handler is logic, written by hand in each parent.`, defaultHint(prop, '() => void'));
  }
  if (options.name !== undefined && options.moveTo !== undefined) {
    throw updateError('options-conflict', '--name and a move cannot be combined yet.', 'Run them one after the other: first the move, then --name.');
  }
  let component = await resolveComponent(changes.root, config, options.target);
  // The name or the place first: the interface operations then work on the files where they end up.
  if (options.name !== undefined && options.name !== component.name) component = await planRename(changes, config, component, options.name);
  if (options.moveTo !== undefined) component = await planComponentMove(changes, config, component, options.moveTo);
  const interfaceOptions = await withoutStyleableProp(changes, config, component, options);
  const warnings = [interfaceOptions.interface, interfaceOptions.removeInterface, interfaceOptions.renameInterface].some((value) => value !== undefined)
    ? await planInterface(changes, config, component, interfaceOptions)
    : [];
  return { name: component.name, folder: component.folderRel, warnings };
}

/**
 * `--interface "className?: string"` makes the component styleable, as styling it from a parent does: its interface
 * extends StyleableProps and its root merges the class. The other props are set as usual.
 */
async function withoutStyleableProp(changes: ChangeSet, config: ResolvedConfig, component: ProjectComponent, options: ComponentUpdateOptions): Promise<ComponentUpdateOptions> {
  if (!options.interface?.trim()) return options;
  const prop = await styleableProp(changes, config);
  const pattern = new RegExp(`(^|;)\\s*${prop}\\??\\s*:[^;]*`);
  if (!pattern.test(options.interface)) return options;
  await planMakeStyleable(changes, config, component.folderRel, component.name);
  const rest = options.interface
    .replace(pattern, '$1')
    .replace(/;\s*;/g, ';')
    .replace(/^\s*;|;\s*$/g, '')
    .trim();
  return { ...options, interface: rest || undefined };
}


/**
 * How to give the usages a new required prop, for its type: a --default written as in JSX (a string in quotes,
 * anything else in braces), or, for a function, an optional prop, since a handler is logic written in each parent.
 */
export function defaultHint(prop: string, type: string): string {
  const optional = `Add it as optional ("${prop}?: ${type}")`;
  if (/=>/.test(type)) {
    return `${optional}: a function is logic, so it has no default. Write the handler by hand in each parent, then pass it with element update <id> --props "${prop}={handle${prop[0]!.toUpperCase()}${prop.slice(1)}}".`;
  }
  const members = type.split('|').map((member) => member.trim());
  const literal = members.find((member) => /^(['"]).*\1$/.test(member));
  const example =
    members.includes('null') ? '"{null}"'
    : members.includes('boolean') ? '"{false}"'
    : members.includes('number') ? '"{0}"'
    : literal ? `"'${literal.slice(1, -1)}'"`
    : members.includes('string') ? `"'…'"`
    : '"{value}"';
  return `${optional}, or give the existing usages a value with --default, written as in JSX: a string in quotes ("'md'"), anything else in braces ("{false}", "{null}", "{2}"); here e.g. --default ${example}.`;
}
