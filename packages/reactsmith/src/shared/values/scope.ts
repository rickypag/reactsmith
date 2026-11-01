import ts from 'typescript';
import { addNamedImport } from '../code/insert.js';
import { interfaceDefaults } from '../components/props.js';
import { componentFunction } from '../elements/tree.js';
import { IssueError } from '../issues.js';

/** What the component of a file can use in a value: its props, and the names already in scope. */
export interface ComponentNames {
  /** Members of the component's props type. */
  props: Set<string>;
  /**
   * Names usable as they are: parameters (and destructured props), constants of the component and imports.
   * Not the file's own top-level constants: a component file holds only the component, constants go in constants.ts.
   */
  inScope: Set<string>;
  /** The parameter when it is a plain name, as in `(props) =>`: props are then used through it. */
  propsParameter?: string;
  /** Props destructured under another name, as in `({ label: text })`: "label" → "text". */
  renamed: Map<string, string>;
}

function namesOf(binding: ts.BindingName): string[] {
  if (ts.isIdentifier(binding)) return [binding.text];
  return binding.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : namesOf(element.name)));
}

function variableNames(statements: readonly ts.Statement[]): string[] {
  return statements.flatMap((statement) =>
    ts.isVariableStatement(statement) ? statement.declarationList.declarations.flatMap((declaration) => namesOf(declaration.name)) : [],
  );
}

function importNames(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements.filter(ts.isImportDeclaration).flatMap((declaration) => {
    const clause = declaration.importClause;
    if (!clause || clause.isTypeOnly) return [];
    const bindings = clause.namedBindings;
    const named = !bindings
      ? []
      : ts.isNamespaceImport(bindings)
        ? [bindings.name.text]
        : bindings.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text);
    return [...(clause.name ? [clause.name.text] : []), ...named];
  });
}

/** The name of the props type: the type argument of `React.FC<…>`, or "<Name>Props". */
function propsTypeName(sourceFile: ts.SourceFile, name: string): string {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const type = declaration.type;
      const argument = type && ts.isTypeReferenceNode(type) ? type.typeArguments?.[0] : undefined;
      if (argument && ts.isTypeReferenceNode(argument) && ts.isIdentifier(argument.typeName)) return argument.typeName.text;
    }
  }
  return `${name}Props`;
}

function propsOf(sourceFile: ts.SourceFile, typeName: string): Set<string> {
  for (const statement of sourceFile.statements) {
    const members =
      ts.isInterfaceDeclaration(statement) && statement.name.text === typeName
        ? statement.members
        : ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName && ts.isTypeLiteralNode(statement.type)
          ? statement.type.members
          : undefined;
    if (members) return new Set(members.flatMap((member) => (member.name && ts.isIdentifier(member.name) ? [member.name.text] : [])));
  }
  return new Set();
}

/** The names the component `name` of the file can use, or undefined when the file has no such component. */
export function componentNames(sourceFile: ts.SourceFile, name: string): ComponentNames | undefined {
  const fn = componentFunction(sourceFile, name);
  if (!fn) return undefined;
  const parameter = fn.parameters[0];
  const inScope = new Set([
    ...importNames(sourceFile),
    ...(ts.isBlock(fn.body) ? variableNames(fn.body.statements) : []),
    ...(parameter ? namesOf(parameter.name) : []),
  ]);
  const propsParameter = parameter && ts.isIdentifier(parameter.name) ? parameter.name.text : undefined;
  const renamed = new Map<string, string>();
  if (parameter && ts.isObjectBindingPattern(parameter.name)) {
    for (const element of parameter.name.elements) {
      if (element.propertyName && ts.isIdentifier(element.propertyName) && ts.isIdentifier(element.name)) renamed.set(element.propertyName.text, element.name.text);
    }
  }
  return { props: propsOf(sourceFile, propsTypeName(sourceFile, name)), inScope, propsParameter, renamed };
}

export interface ResolveOptions {
  /** The hint when a name is unknown. */
  hint?: string;
  /** Constants the file can import, nearest first: name → import specifier. */
  constants?: Map<string, string>;
}

export interface Resolved {
  /** Props to destructure. */
  props: string[];
  /** Constants to import: name → specifier. */
  imports: Map<string, string>;
}

/**
 * Checks the variables of a value against the component of `file`: names in scope, then props, which get
 * destructured, then constants of the constants files the file can use, which get imported. Throws for anything else.
 */
export function resolveNames(names: ComponentNames, used: string[], where: { file: string; component: string } & ResolveOptions): Resolved {
  const toDestructure: string[] = [];
  const imports = new Map<string, string>();
  for (const name of used) {
    if (names.inScope.has(name)) continue;
    if (names.props.has(name)) {
      const alias = names.renamed.get(name);
      if (alias) {
        throw new IssueError({
          severity: 'error',
          code: 'value-name-unknown',
          path: where.file,
          message: `The prop "${name}" of ${where.component} is destructured as "${alias}".`,
          hint: `Use {${alias}}.`,
        });
      }
      if (names.propsParameter) {
        throw new IssueError({
          severity: 'error',
          code: 'value-name-unknown',
          path: where.file,
          message: `"${name}" is a prop of ${where.component}, which takes its props as "${names.propsParameter}".`,
          hint: `Use {${names.propsParameter}.${name}}.`,
        });
      }
      toDestructure.push(name);
      continue;
    }
    const specifier = where.constants?.get(name);
    if (specifier) {
      imports.set(name, specifier);
      continue;
    }
    throw new IssueError({
      severity: 'error',
      code: 'value-name-unknown',
      path: where.file,
      message: `"${name}" is not a prop of ${where.component}, a constant, nor an import of its file.`,
      hint: where.hint ?? `Add it to the props of ${where.component}, or create it with "constant create ${name}".`,
    });
  }
  return { props: toDestructure, imports };
}

/** Adds props to the destructured parameter of the component: `() =>` becomes `({ label }) =>`, `({ a }) =>` becomes `({ a, label }) =>`. */
export function destructureProps(text: string, fileName: string, component: string, names: string[]): string {
  if (names.length === 0) return text;
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = componentFunction(sourceFile, component);
  if (!fn) throw new Error(`No component "${component}" in ${fileName}`);
  // A prop with a default in the interface ("@default true") gets it where it is destructured: "showName = true".
  const defaults = interfaceDefaults(sourceFile, component);
  const props = names.map((prop) => {
    const value = defaults.get(prop.split(':')[0]!.trim());
    return value === undefined ? prop : `${prop} = ${value}`;
  });
  const parameter = fn.parameters[0];

  if (!parameter) {
    const open = text.indexOf('(', fn.getStart(sourceFile));
    const close = text.indexOf(')', open);
    return `${text.slice(0, open)}({ ${props.join(', ')} })${text.slice(close + 1)}`;
  }
  const pattern = parameter.name;
  if (!ts.isObjectBindingPattern(pattern)) throw new Error(`The props of "${component}" are not destructured in ${fileName}`);
  const rest = pattern.elements.find((element) => element.dotDotDotToken);
  if (rest) return `${text.slice(0, rest.getStart(sourceFile))}${props.join(', ')}, ${text.slice(rest.getStart(sourceFile))}`;
  const last = pattern.elements[pattern.elements.length - 1];
  if (!last) return `${text.slice(0, pattern.getStart(sourceFile))}{ ${props.join(', ')} }${text.slice(pattern.getEnd())}`;
  return `${text.slice(0, last.getEnd())}, ${props.join(', ')}${text.slice(last.getEnd())}`;
}

/**
 * Removes a prop from the destructured parameter of the component, the opposite of destructureProps:
 * `({ a, label }) =>` becomes `({ a }) =>`, `({ label }) =>` becomes `() =>`. Undefined when it is not destructured there.
 */
export function undestructureProp(text: string, fileName: string, component: string, prop: string): string | undefined {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const parameter = componentFunction(sourceFile, component)?.parameters[0];
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return undefined;
  const elements = parameter.name.elements;
  const index = elements.findIndex((element) => !element.propertyName && !element.dotDotDotToken && ts.isIdentifier(element.name) && element.name.text === prop);
  if (index === -1) return undefined;
  const element = elements[index]!;
  // "a, label" → "a", "label, b" → "b", "label" → "" (and the empty pattern goes).
  const [start, end] =
    elements.length === 1
      ? [parameter.getStart(sourceFile), parameter.getEnd()]
      : index === elements.length - 1
        ? [elements[index - 1]!.getEnd(), element.getEnd()]
        : [element.getStart(sourceFile), elements[index + 1]!.getStart(sourceFile)];
  return `${text.slice(0, start)}${text.slice(end)}`;
}

/**
 * Checks the variables of `used` against the component of a file, destructures the props they need
 * and imports the constants they use. Returns the updated text.
 */
export function applyNames(text: string, file: string, component: string, used: string[], options: ResolveOptions = {}): string {
  if (used.length === 0) return text;
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = componentNames(sourceFile, component);
  if (!names) throw new Error(`No component "${component}" in ${file}`);
  const resolved = resolveNames(names, used, { file, component, ...options });
  let updated = destructureProps(text, file, component, resolved.props);
  for (const [name, specifier] of resolved.imports) updated = addNamedImport(updated, file, name, specifier);
  return updated;
}
