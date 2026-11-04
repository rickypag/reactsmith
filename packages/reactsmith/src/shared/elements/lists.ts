import ts from 'typescript';

/**
 * A list: `{links.map((link) => <NavLink key={link.href} … />)}`. It repeats exactly one component,
 * with a key, over a variable: any logic (filtering, sorting, conditions) happens before it or in the component.
 */
export interface List {
  /** The list, as written: "links", "section.pages". */
  each: string;
  /** The name of each item: "link". */
  item: string;
  /** The repeated component: "NavLink". */
  component: string;
}

export type ListShape = { ok: true; list: List } | { ok: false; reason: string; component?: string };

function unwrap(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression;
}

function isNamePath(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return true;
  return ts.isPropertyAccessExpression(expression) && !expression.questionDotToken && isNamePath(expression.expression);
}

/** The `.map(…)` call an expression is, if it is one. */
export function mapCall(expression: ts.Expression | undefined): ts.CallExpression | undefined {
  if (!expression) return undefined;
  const call = unwrap(expression);
  if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return undefined;
  return call.expression.name.text === 'map' ? call : undefined;
}

/** Checks a `.map(…)` call against the shape of a list. */
export function listShape(call: ts.CallExpression, sourceFile: ts.SourceFile): ListShape {
  const callee = call.expression as ts.PropertyAccessExpression;
  const callback = call.arguments[0] ? unwrap(call.arguments[0]) : undefined;
  const body = callback && ts.isArrowFunction(callback) && !ts.isBlock(callback.body) ? unwrap(callback.body) : undefined;
  const component = body && ts.isJsxSelfClosingElement(body) ? body.tagName.getText(sourceFile) : undefined;

  const fail = (reason: string): ListShape => ({ ok: false, reason, component });
  if (callee.questionDotToken || !isNamePath(callee.expression)) {
    return fail('the list must be a variable, e.g. {links.map(…)}: compute it first, e.g. "const visible = links.filter(…)"');
  }
  if (call.arguments.length !== 1 || !callback || !ts.isArrowFunction(callback)) return fail('it must map with an arrow function, e.g. (link) => <NavLink … />');
  const parameter = callback.parameters[0];
  if (callback.parameters.length !== 1 || !parameter || !ts.isIdentifier(parameter.name)) {
    return fail('the arrow function must take just the item, by name, e.g. (link) =>');
  }
  if (!body) return fail('the arrow function must return the component directly, without a block or other logic');
  // A component with content of its own (an inner list, other elements): that content belongs inside the component.
  if (ts.isJsxElement(body) && /^[A-Z]/.test(body.openingElement.tagName.getText(sourceFile))) {
    const name = body.openingElement.tagName.getText(sourceFile);
    return fail(`the repeated <${name}> must take no content here: put it inside ${name}, e.g. an inner list over a prop (items={${parameter.name.getText(sourceFile)}.items}) that ${name} repeats itself`);
  }
  if (!ts.isJsxSelfClosingElement(body) || !/^[A-Z]/.test(body.tagName.getText(sourceFile))) {
    return fail('it must repeat exactly one component, e.g. <NavLink … />, not HTML elements or text');
  }
  const hasKey = body.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'key');
  if (!hasKey) return fail('the component needs a key, e.g. key={link.id}');
  return { ok: true, list: { each: callee.expression.getText(sourceFile), item: parameter.name.text, component: component! } };
}
