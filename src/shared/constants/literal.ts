import ts from 'typescript';

/** Above this width, arrays and objects are written one item per line. */
const MAX_INLINE = 80;

function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

function key(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : quote(name);
}

/** A JSON value as a TypeScript literal, in the style of the generated code: single quotes, unquoted keys. */
export function toLiteral(value: unknown, indent = ''): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => toLiteral(item, inner));
    const inline = `[${items.join(', ')}]`;
    if (inline.length + indent.length <= MAX_INLINE && !inline.includes('\n')) return inline;
    return `[\n${items.map((item) => `${inner}${item},\n`).join('')}${indent}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).map(([name, item]) => `${key(name)}: ${toLiteral(item, inner)}`);
  if (entries.length === 0) return '{}';
  const inline = `{ ${entries.join(', ')} }`;
  if (inline.length + indent.length <= MAX_INLINE && !inline.includes('\n')) return inline;
  return `{\n${entries.map((entry) => `${inner}${entry},\n`).join('')}${indent}}`;
}

/** Whether an expression is plain data: strings, numbers, booleans, null, and arrays and objects of them. */
export function isDataLiteral(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) return isDataLiteral(expression.expression);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) || ts.isNumericLiteral(expression)) return true;
  if (ts.isPrefixUnaryExpression(expression)) return expression.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expression.operand);
  if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(expression.kind)) return true;
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.every((element) => !ts.isSpreadElement(element) && isDataLiteral(element));
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.every(
      (property) => ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name) && isDataLiteral(property.initializer),
    );
  }
  return false;
}
