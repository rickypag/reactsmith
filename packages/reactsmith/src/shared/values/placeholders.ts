import ts from 'typescript';
import { componentFunction } from '../elements/tree.js';
import type { ParsedProps } from '../elements/props.js';

/** What a variable is passed to: the prop of a component, and the prop's type as its interface writes it. */
export interface PropTarget {
  /** The component's name where it is used: "FilterGroup", or its alias. */
  component: string;
  prop: string;
  /** The type as written in the interface: "string", "'sm' | 'lg'", "Choice[]". */
  type: string;
}

const parseType = (type: string): ts.TypeNode | undefined => {
  const sourceFile = ts.createSourceFile('type.ts', `type T = ${type};`, ts.ScriptTarget.Latest, true);
  const statement = sourceFile.statements[0];
  return statement && ts.isTypeAliasDeclaration(statement) ? statement.type : undefined;
};

const unwrap = (node: ts.TypeNode): ts.TypeNode => (ts.isParenthesizedTypeNode(node) ? unwrap(node.type) : node);

/** `undefined` and `null` in a union: an optional value, not the value itself. */
const isNothing = (node: ts.TypeNode) =>
  node.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword);

/** A literal type's value as code: "'sm'", "2", "true". */
function literalValue(node: ts.TypeNode): string | undefined {
  if (!ts.isLiteralTypeNode(node)) return undefined;
  const literal = node.literal;
  if (ts.isStringLiteral(literal)) return `'${literal.text.replace(/'/g, "\\'")}'`;
  if (ts.isNumericLiteral(literal)) return literal.text;
  if (ts.isPrefixUnaryExpression(literal) && ts.isNumericLiteral(literal.operand)) return `-${literal.operand.text}`;
  if (literal.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (literal.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  return undefined;
}

const KEYWORD_VALUES = new Map([
  [ts.SyntaxKind.StringKeyword, "''"],
  [ts.SyntaxKind.NumberKeyword, '0'],
  [ts.SyntaxKind.BooleanKeyword, 'false'],
]);

/** A type written only with keywords and literals ("string", "'a' | 'b'"): it can be named in any file. */
function isPlainType(node: ts.TypeNode): boolean {
  const type = unwrap(node);
  if (KEYWORD_VALUES.has(type.kind) || isNothing(type) || literalValue(type) !== undefined) return true;
  if (ts.isUnionTypeNode(type)) return type.types.every(isPlainType);
  const element = listElement(type);
  return element !== undefined && isPlainType(element);
}

/** The element type of a list type: `T[]`, `readonly T[]`, `Array<T>`, `ReadonlyArray<T>`. */
function listElement(node: ts.TypeNode): ts.TypeNode | undefined {
  const type = unwrap(node);
  if (ts.isArrayTypeNode(type)) return type.elementType;
  if (ts.isTypeOperatorNode(type) && type.operator === ts.SyntaxKind.ReadonlyKeyword) return listElement(type.type);
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && ['Array', 'ReadonlyArray'].includes(type.typeName.text) && type.typeArguments?.length === 1) {
    return type.typeArguments[0];
  }
  return undefined;
}

/** A placeholder value of a basic type, and the type to declare it with when the value alone doesn't give it. */
function placeholderValue(node: ts.TypeNode): { value: string; list: boolean } | undefined {
  const type = unwrap(node);
  const keyword = KEYWORD_VALUES.get(type.kind);
  if (keyword) return { value: keyword, list: false };
  const literal = literalValue(type);
  if (literal) return { value: literal, list: false };
  if (listElement(type)) return { value: '[]', list: true };
  if (ts.isUnionTypeNode(type)) {
    // An optional value is a value: "string | undefined" is a string. Else a union of literals takes its first.
    const values = type.types.filter((member) => !isNothing(member));
    if (values.length === 1) return placeholderValue(values[0]!);
    if (values.length > 1 && values.every((member) => literalValue(unwrap(member)) !== undefined)) return { value: literalValue(unwrap(values[0]!))!, list: false };
  }
  return undefined;
}

/**
 * The declaration of a placeholder variable for a value passed to a prop, when the prop's type is basic: a string,
 * a number, a boolean, a union of literals, or a list. Undefined for any other type (an object, a function, a type of
 * the project), which has no value that could stand in for it.
 */
export function placeholderDeclaration(name: string, target: PropTarget): string | undefined {
  const node = parseType(target.type);
  const placeholder = node && placeholderValue(node);
  if (!node || !placeholder) return undefined;
  // An empty list needs its type: written as is when it is plain, else taken from the component's props.
  const annotation = placeholder.list ? `: ${isPlainType(node) ? target.type : `React.ComponentProps<typeof ${target.component}>['${target.prop}']`}` : '';
  return `const ${name}${annotation} = ${placeholder.value}; // placeholder: give it its real value`;
}

/** The props of a component's interface, with their types as written: "label" → "string". */
export function propTypes(componentText: string, name: string): Map<string, string> {
  const sourceFile = ts.createSourceFile(`${name}.tsx`, componentText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const props = sourceFile.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === `${name}Props`);
  const types = new Map<string, string>();
  for (const member of props?.members ?? []) {
    if (ts.isPropertySignature(member) && member.type && ts.isIdentifier(member.name)) types.set(member.name.text, member.type.getText(sourceFile));
  }
  return types;
}

/**
 * The variables given straight to a prop of a component of the project (`filters={filters}`), with what they are
 * passed to: those can get a placeholder when the file doesn't have them.
 */
export function propTargets(parsed: ParsedProps, component: string, types: Map<string, string>): Map<string, PropTarget> {
  const targets = new Map<string, PropTarget>();
  for (const attribute of parsed.attributes) {
    if (!attribute.name) continue;
    const variable = /^[A-Za-z_$][\w$-]*=\{\s*([A-Za-z_$][\w$]*)\s*\}$/.exec(attribute.text)?.[1];
    const type = types.get(attribute.name);
    if (variable && type) targets.set(variable, { component, prop: attribute.name, type });
  }
  return targets;
}

/**
 * Adds statements to the body of a component, where its variables are declared: before its first `if` or `return`.
 * A component that returns its JSX directly (`=> <div />`) gets a body: `=> { …; return <div />; }`.
 */
export function addBodyStatements(text: string, fileName: string, component: string, statements: string[]): string {
  if (statements.length === 0) return text;
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = componentFunction(sourceFile, component);
  if (!fn) throw new Error(`No component "${component}" in ${fileName}`);
  if (!ts.isBlock(fn.body)) {
    const body = fn.body;
    return `${text.slice(0, body.getStart(sourceFile))}{\n${statements.map((statement) => `  ${statement}\n`).join('')}  return ${body.getText(sourceFile)};\n}${text.slice(body.getEnd())}`;
  }
  const before = fn.body.statements.find((statement) => ts.isReturnStatement(statement) || ts.isIfStatement(statement));
  if (before) {
    // Above the comments that describe the statement, not between them.
    const comment = ts.getLeadingCommentRanges(text, before.getFullStart())?.[0];
    const lineStart = text.lastIndexOf('\n', comment?.pos ?? before.getStart(sourceFile)) + 1;
    const indent = /^[ \t]*/.exec(text.slice(lineStart))![0];
    return `${text.slice(0, lineStart)}${statements.map((statement) => `${indent}${statement}\n`).join('')}${text.slice(lineStart)}`;
  }
  const close = fn.body.getEnd() - 1;
  const lineStart = text.lastIndexOf('\n', close) + 1;
  const indent = `${/^[ \t]*/.exec(text.slice(lineStart))![0]}  `;
  return `${text.slice(0, lineStart)}${statements.map((statement) => `${indent}${statement}\n`).join('')}${text.slice(lineStart)}`;
}
