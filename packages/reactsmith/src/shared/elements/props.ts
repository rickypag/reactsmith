import ts from 'typescript';
import { IssueError } from '../issues.js';

/** Props given with --props, parsed and checked: values are variables and literals only. */
export interface ParsedProps {
  /** The props as JSX, with a leading space, or "" when there are none. */
  jsx: string;
  /** Each prop as written: 'to="/"', "{...link}". */
  attributes: { name?: string; text: string }[];
  /** The variables the values use: "href" for to={href}, "link" for {...link}. */
  names: string[];
}

function propsError(code: string, message: string, hint: string): IssueError {
  return new IssueError({ severity: 'error', code, message, hint });
}

/**
 * The variables a value uses, or undefined when it is not allowed. Values are variables (names and property paths)
 * and literals, possibly in arrays and objects: no calls, operators or functions.
 */
function valueNames(expression: ts.Expression): string[] | undefined {
  if (ts.isParenthesizedExpression(expression)) return valueNames(expression.expression);
  if (ts.isIdentifier(expression)) return expression.text === 'undefined' ? [] : [expression.text];
  if (ts.isPropertyAccessExpression(expression) && !expression.questionDotToken) {
    let object: ts.Expression = expression;
    while (ts.isPropertyAccessExpression(object) && !object.questionDotToken) object = object.expression;
    return ts.isIdentifier(object) ? [object.text] : undefined;
  }
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) || ts.isNumericLiteral(expression)) return [];
  // A template string only puts variables into text: `/docs/${slug}`.
  if (ts.isTemplateExpression(expression)) {
    const spans = expression.templateSpans.map((span) => (ts.isIdentifier(span.expression) || ts.isPropertyAccessExpression(span.expression) ? valueNames(span.expression) : undefined));
    return spans.some((span) => span === undefined) ? undefined : (spans.flat() as string[]);
  }
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expression.operand)) return [];
  if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(expression.kind)) return [];
  const all = (values: (string[] | undefined)[]) => (values.some((value) => value === undefined) ? undefined : (values.flat() as string[]));
  if (ts.isArrayLiteralExpression(expression)) return all(expression.elements.map((element) => (ts.isSpreadElement(element) ? undefined : valueNames(element))));
  if (ts.isObjectLiteralExpression(expression)) {
    return all(
      expression.properties.map((property) => {
        if (ts.isShorthandPropertyAssignment(property)) return [property.name.text];
        if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) return valueNames(property.initializer);
        return undefined;
      }),
    );
  }
  return undefined;
}

/** Parses props written as JSX attributes, 'to="/" items={links} {...link}', and checks their values. */
export function parseAttributes(text: string | undefined, tag: string): ParsedProps {
  const written = text?.trim() ?? '';
  if (!written) return { jsx: '', attributes: [], names: [] };
  const sourceFile = ts.createSourceFile('props.tsx', `<${tag} ${written} />;`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { diagnostics } = ts.transpileModule(sourceFile.text, { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve }, fileName: 'props.tsx' });
  const statement = sourceFile.statements[0];
  const element = statement && ts.isExpressionStatement(statement) ? statement.expression : undefined;
  if (diagnostics?.length || sourceFile.statements.length !== 1 || !element || !ts.isJsxSelfClosingElement(element)) {
    throw propsError('props-invalid', `The props "${written}" are not valid JSX attributes.`, 'Write them as in JSX: \'title="Docs" items={links}\'.');
  }

  const names = new Set<string>();
  const attributes: ParsedProps['attributes'] = [];
  for (const attribute of element.attributes.properties) {
    attributes.push({ name: ts.isJsxAttribute(attribute) ? attribute.name.getText(sourceFile) : undefined, text: attribute.getText(sourceFile) });
    const value = ts.isJsxSpreadAttribute(attribute) ? attribute.expression : attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
    if (!value) continue;
    const used = ts.isJsxSpreadAttribute(attribute) && !ts.isIdentifier(value) && !ts.isPropertyAccessExpression(value) ? undefined : valueNames(value);
    if (!used) {
      throw propsError(
        'value-expression-not-allowed',
        `"${attribute.getText(sourceFile)}" computes its value: only variables (names and property paths) and literals are allowed.`,
        'Compute the value in a variable first, e.g. "const items = getItems()", and pass items={items}.',
      );
    }
    used.forEach((name) => names.add(name));
  }
  return { jsx: ` ${written}`, attributes, names: [...names] };
}

/** The props a component of the project declares: every member of `<Name>Props`, and which ones are required. */
export function declaredProps(componentText: string, name: string): { all: Set<string>; required: string[] } {
  const sourceFile = ts.createSourceFile(`${name}.tsx`, componentText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const props = sourceFile.statements.find(
    (statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === `${name}Props`,
  );
  const members = (props?.members ?? []).filter((member) => member.name && ts.isIdentifier(member.name));
  return {
    all: new Set(members.map((member) => (member.name as ts.Identifier).text)),
    required: members.filter((member) => !member.questionToken).map((member) => (member.name as ts.Identifier).text),
  };
}

/**
 * Checks props against the interface of a component of the project: each must be declared, and the required ones
 * given (unless a spread may give them). `extra` are props the command adds itself, such as key or className.
 */
export function checkDeclaredProps(parsed: ParsedProps, name: string, declared: { all: Set<string>; required: string[] }, extra: string[] = [], option = '--props'): void {
  for (const prop of [...parsed.attributes.flatMap((attribute) => (attribute.name ? [attribute.name] : [])), ...extra.filter((prop) => prop !== 'key')]) {
    if (!declared.all.has(prop)) {
      const known = declared.all.size ? `Its props are: ${[...declared.all].join(', ')}.` : 'It has no props.';
      throw propsError('props-unknown', `"${name}" has no prop "${prop}".`, known);
    }
  }
  if (parsed.attributes.some((attribute) => !attribute.name)) return;
  const given = new Set([...parsed.attributes.map((attribute) => attribute.name!), ...extra]);
  const missing = declared.required.filter((prop) => !given.has(prop));
  if (missing.length) {
    throw propsError(
      'props-required',
      `"${name}" needs ${missing.map((prop) => `"${prop}"`).join(', ')}, or the code would not compile.`,
      `Pass ${missing.length === 1 ? 'it' : 'them'} with ${option}, e.g. ${option} '${missing.map((prop) => `${prop}={…}`).join(' ')}'.`,
    );
  }
}
