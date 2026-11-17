import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { barrelOf, planBarrelExports } from '../code/barrel.js';
import { addImport } from '../code/insert.js';
import type { ResolvedConfig } from '../config/types.js';
import { componentFunction } from '../elements/tree.js';
import { relativeImport } from '../imports/specifiers.js';
import { IssueError } from '../issues.js';
import { destructureProps } from '../values/scope.js';

/**
 * A parent styles a component of the project the way it styles any element: with a class from its own style file.
 * The component takes it through one shared prop, declared once in StyleableProps, and merges it into its root
 * element with cx: <button className={cx(styles.root, className)}>.
 */
export const STYLEABLE_INTERFACE = 'StyleableProps';
const STYLEABLE_FILE = 'styleable.ts';
const CX_FILE = 'cx.ts';
const DEFAULT_PROP = 'className';

const STYLEABLE_CONTENT = `/** The props of a component its parent can style: the class is merged into the component's root element. */
export interface ${STYLEABLE_INTERFACE} {
  ${DEFAULT_PROP}?: string;
}
`;

const CX_CONTENT = `/** Joins class names, skipping empty ones: cx(styles.root, className). */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
`;

/** Where the shared interface and the helper live: the shared types and utils folders. Undefined when they are disabled. */
export function styleableFiles(config: ResolvedConfig): { interfaceRel: string; cxRel: string } | undefined {
  const { srcDir, folders } = config;
  if (!folders.types || !folders.utils) return undefined;
  return { interfaceRel: `${srcDir}/${folders.types}/${STYLEABLE_FILE}`, cxRel: `${srcDir}/${folders.utils}/${CX_FILE}` };
}

/**
 * Plans the shared interface and the helper when they are missing, each exported from its folder's barrel:
 * init creates them, commands recreate them.
 */
export async function planStyleableFiles(changes: ChangeSet, config: ResolvedConfig): Promise<void> {
  const files = styleableFiles(config);
  if (!files) return;
  if ((await changes.read(files.interfaceRel)) === undefined) {
    changes.write(files.interfaceRel, STYLEABLE_CONTENT, { type: 'create', message: 'the props of a component its parent can style' });
  }
  await planBarrelExports(changes, barrelOf(files.interfaceRel), [`export type { ${STYLEABLE_INTERFACE} } from './${STYLEABLE_FILE.replace(/\.ts$/, '')}';`]);
  if ((await changes.read(files.cxRel)) === undefined) {
    changes.write(files.cxRel, CX_CONTENT, { type: 'create', message: 'cx, which joins class names' });
  }
  await planBarrelExports(changes, barrelOf(files.cxRel), [`export { cx } from './${CX_FILE.replace(/\.ts$/, '')}';`]);
}

/** The name of the styleable prop, as declared in StyleableProps: "className" unless the team renamed it. */
export async function styleableProp(changes: ChangeSet, config: ResolvedConfig): Promise<string> {
  const files = styleableFiles(config);
  return styleablePropIn(files ? await changes.read(files.interfaceRel) : undefined);
}

/** The styleable prop declared in the text of styleable.ts. */
export function styleablePropIn(text: string | undefined): string {
  if (!text) return DEFAULT_PROP;
  const sourceFile = ts.createSourceFile(STYLEABLE_FILE, text, ts.ScriptTarget.Latest, true);
  const declaration = sourceFile.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === STYLEABLE_INTERFACE);
  const member = declaration?.members.find((candidate) => candidate.name && ts.isIdentifier(candidate.name));
  return member?.name && ts.isIdentifier(member.name) ? member.name.text : DEFAULT_PROP;
}

/** The props interface of a component, `<Name>Props`. */
export function propsInterface(sourceFile: ts.SourceFile, name: string): ts.InterfaceDeclaration | undefined {
  return sourceFile.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === `${name}Props`);
}

/** Whether a props interface extends StyleableProps. */
export function isStyleable(declaration: ts.InterfaceDeclaration | undefined): boolean {
  return !!declaration?.heritageClauses?.some((clause) => clause.types.some((type) => type.expression.getText() === STYLEABLE_INTERFACE));
}

/** The type of a component's variable, `React.FC<…>`, when it is one. */
function componentType(sourceFile: ts.SourceFile, name: string): ts.TypeReferenceNode | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find((candidate) => candidate.name.getText(sourceFile) === name);
    if (declaration?.type && ts.isTypeReferenceNode(declaration.type)) return declaration.type;
  }
  return undefined;
}

/**
 * Whether a component takes a class from its parent: its props interface extends StyleableProps, or, without props of
 * its own, it is typed React.FC<StyleableProps> (no empty interface, which linters reject).
 */
export function isStyleableComponent(sourceFile: ts.SourceFile, name: string): boolean {
  if (isStyleable(propsInterface(sourceFile, name))) return true;
  const argument = componentType(sourceFile, name)?.typeArguments?.[0];
  return argument?.getText(sourceFile) === STYLEABLE_INTERFACE;
}

function styleableError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

const parse = (fileRel: string, text: string) => ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** The specifier a file imports a shared file with, through its folder's barrel: the alias path ("@/utils"), or a relative path. */
function sharedImport(config: ResolvedConfig, fileRel: string, targetRel: string): string {
  const barrel = barrelOf(targetRel);
  return config.alias ? `${config.alias}/${barrel.slice(config.srcDir.length + 1).replace(/\/index\.ts$/, '')}` : relativeImport(fileRel, barrel);
}

/**
 * Makes a component of the project styleable, unless it is already: its props interface extends StyleableProps
 * (created when it has none), and its root element merges the prop: className={cx(styles.root, className)}.
 * Returns whether anything changed.
 */
export async function planMakeStyleable(changes: ChangeSet, config: ResolvedConfig, folderRel: string, name: string): Promise<boolean> {
  const fileRel = `${folderRel}/${name}.tsx`;
  let text = await changes.read(fileRel);
  if (text === undefined) throw styleableError('component-missing', `${fileRel} does not exist.`, 'Check the component.', fileRel);
  if (isStyleableComponent(parse(fileRel, text), name)) return false;

  const files = styleableFiles(config);
  if (!files) {
    throw styleableError('styleable-folders-disabled', 'Components can be styled from their parent only with the shared types and utils folders.', 'Enable "folders.types" and "folders.utils" in the config.', fileRel);
  }
  await planStyleableFiles(changes, config);
  const prop = await styleableProp(changes, config);

  // The root element: its className={styles.root} becomes className={cx(styles.root, className)}.
  let sourceFile = parse(fileRel, text);
  const fn = componentFunction(sourceFile, name);
  const root = fn && findRoot(fn);
  const opening = root && (ts.isJsxElement(root) ? root.openingElement : root);
  const classAttribute = opening?.attributes.properties.find((attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'className');
  const value = classAttribute?.initializer && ts.isJsxExpression(classAttribute.initializer) ? classAttribute.initializer.expression?.getText(sourceFile) : undefined;
  if (!opening || (classAttribute && value !== 'styles.root')) {
    throw styleableError(
      'component-not-styleable',
      `"${name}" can't take a style from its parent: its root element doesn't use className={styles.root}.`,
      'Give its root the style "root" (it is how components are created), then style it again.',
      fileRel,
    );
  }
  const merged = `className={cx(${classAttribute ? 'styles.root, ' : ''}${prop})}`;
  text = classAttribute
    ? `${text.slice(0, classAttribute.getStart(sourceFile))}${merged}${text.slice(classAttribute.getEnd())}`
    : `${text.slice(0, opening.tagName.getEnd())} ${merged}${text.slice(opening.tagName.getEnd())}`;

  // The props interface extends StyleableProps; a component without props is typed React.FC<StyleableProps>, rather
  // than with an empty interface, which linters reject. Its first prop gives it the interface (component update).
  sourceFile = parse(fileRel, text);
  const declaration = propsInterface(sourceFile, name);
  if (declaration) {
    const clause = declaration.heritageClauses?.find((candidate) => candidate.token === ts.SyntaxKind.ExtendsKeyword);
    const at = clause ? clause.getEnd() : declaration.name.getEnd();
    text = `${text.slice(0, at)}${clause ? ', ' : ' extends '}${STYLEABLE_INTERFACE}${text.slice(at)}`;
  } else {
    const type = componentType(sourceFile, name);
    if (!type || type.typeArguments || !/^(React\.)?(FC|FunctionComponent)$/.test(type.typeName.getText(sourceFile))) {
      throw styleableError('component-not-styleable', `"${name}" isn't typed as React.FC, so it can't take a class from its parent.`, `Type it as "export const ${name}: React.FC = () => …", then style it again.`, fileRel);
    }
    text = `${text.slice(0, type.typeName.getEnd())}<${STYLEABLE_INTERFACE}>${text.slice(type.typeName.getEnd())}`;
  }

  text = destructureProps(text, fileRel, name, [prop]);
  text = addImport(text, parse(fileRel, text), `import type { ${STYLEABLE_INTERFACE} } from '${sharedImport(config, fileRel, files.interfaceRel)}'`);
  text = addImport(text, parse(fileRel, text), `import { cx } from '${sharedImport(config, fileRel, files.cxRel)}'`);
  changes.write(fileRel, text, { type: 'update', message: `made "${name}" styleable: it merges the ${prop} its parent passes into its root` });
  return true;
}

/** The root JSX element a component returns. */
function findRoot(fn: ts.ArrowFunction): ts.JsxElement | ts.JsxSelfClosingElement | undefined {
  const unwrap = (expression: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression);
  let returned: ts.Expression | undefined;
  if (ts.isBlock(fn.body)) {
    const visit = (node: ts.Node): void => {
      if (returned || ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) returned = unwrap(node.expression);
      else ts.forEachChild(node, visit);
    };
    fn.body.statements.forEach(visit);
  } else {
    returned = unwrap(fn.body);
  }
  return returned && (ts.isJsxElement(returned) || ts.isJsxSelfClosingElement(returned)) ? returned : undefined;
}

/**
 * Prepares a component of the project for the props its parent gives it: an inline style is refused (components are
 * styled with a class from the parent's style file), and a class makes the component styleable. `styled` is true when
 * the command itself gives the element a class (--name). Returns the styleable prop, so callers accept it as declared.
 */
export async function planComponentStyling(changes: ChangeSet, config: ResolvedConfig, folderRel: string, name: string, attributeNames: (string | undefined)[], styled: boolean): Promise<string> {
  const prop = await styleableProp(changes, config);
  if (attributeNames.includes('style')) {
    throw styleableError(
      'component-inline-style',
      `"${name}" can't take an inline style: a component of the project is styled with a class from its parent's style file.`,
      'Give it a style with --name (e.g. --name menu), or with "style update" on it.',
    );
  }
  if (styled || attributeNames.includes(prop)) await planMakeStyleable(changes, config, folderRel, name);
  return prop;
}
