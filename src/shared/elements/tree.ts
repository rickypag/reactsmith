import ts from 'typescript';
import type { LayoutClassifier } from '../layout/classify.js';
import { conditionShape, isConditionExpression, type Condition } from './conditions.js';
import { listShape, mapCall } from './lists.js';

export interface Position {
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

/**
 * A JSX element of a component; a slot, a prop holding JSX such as `footer={<Button />}`, whose segment
 * is "@footer" and whose children are the elements passed in it; or a list, `{links.map(…)}`, whose
 * segment is "{links}" and which has no children: the component it repeats is not a target of its own; or a
 * condition, `{open && <nav />}`, whose segment is "{?open}" and whose children are its branches.
 */
export interface ElementNode {
  kind: 'element' | 'slot' | 'list' | 'condition';
  /** The tag as written ("Stack", "M.Stack", "nav"), "@footer" for a slot, "{links}" for a list, "{?open}" for a condition. */
  tag: string;
  /** The tag, with "[n]" when siblings share it: "ListItem[2]". */
  segment: string;
  /** Segments from the component's root: "Stack/nav/ListItem[2]". */
  path: string;
  /** Whether other elements can be inserted into it: a layout or an interactive element. */
  layout: boolean;
  start: Position;
  end: Position;
  node: ts.Node;
  children: ElementNode[];
  /** For a list: the component it repeats, when it can be found. */
  component?: string;
  /** The element's name, given with --name: the style it uses, className={styles.<name>}. The root is "root". */
  name?: string;
  /** For a condition: its operator, test and branches. */
  condition?: Condition;
}

export interface ElementTree {
  /** The component the file defines. */
  component: string;
  /** The elements the component returns: usually one. */
  roots: ElementNode[];
  sourceFile: ts.SourceFile;
  /** How many elements use each name: a name used once is the element's id. */
  names: Map<string, number>;
}

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

function unwrap(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression;
}

/** JSX elements in `nodes`, looking through fragments. Text and {expressions} have no elements. */
function jsxElements(nodes: readonly ts.Node[]): JsxNode[] {
  return nodes.flatMap((node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return [node];
    if (ts.isJsxFragment(node)) return jsxElements(node.children);
    return [];
  });
}

/** The component's function: the exported const named like the file, possibly wrapped in memo. */
export function componentFunction(sourceFile: ts.SourceFile, name: string): ts.ArrowFunction | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer) continue;
      let initializer = unwrap(declaration.initializer);
      if (ts.isCallExpression(initializer) && initializer.arguments[0]) initializer = unwrap(initializer.arguments[0]);
      if (ts.isArrowFunction(initializer)) return initializer;
    }
  }
  return undefined;
}

/** The JSX the function returns, not counting nested functions. */
function returnedJsx(fn: ts.ArrowFunction): ts.Node[] {
  if (!ts.isBlock(fn.body)) return [unwrap(fn.body)];
  const returned: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) returned.push(unwrap(node.expression));
    ts.forEachChild(node, visit);
  };
  fn.body.statements.forEach(visit);
  return returned;
}

function positionOf(sourceFile: ts.SourceFile, offset: number): Position {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(offset);
  return { line: line + 1, column: character + 1 };
}

/**
 * The element tree of the component `name` defined in `sourceFile`. Each element is identified by the
 * tags from the root, indexed among siblings with the same tag. Undefined when there is no such component.
 */
export function buildElementTree(sourceFile: ts.SourceFile, name: string, isLayout: LayoutClassifier): ElementTree | undefined {
  const fn = componentFunction(sourceFile, name);
  if (!fn) return undefined;

  const build = (nodes: { tag: string; node: ts.Node; kind: ElementNode['kind'] }[], parentPath: string): ElementNode[] => {
    const counts = new Map<string, number>();
    for (const { tag } of nodes) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const seen = new Map<string, number>();

    return nodes.map(({ tag, node, kind }) => {
      const index = (seen.get(tag) ?? 0) + 1;
      seen.set(tag, index);
      const segment = counts.get(tag)! > 1 ? `${tag}[${index}]` : tag;
      const path = parentPath ? `${parentPath}/${segment}` : segment;
      const element: ElementNode = {
        kind,
        tag,
        segment,
        path,
        layout: false,
        start: positionOf(sourceFile, node.getStart(sourceFile)),
        end: positionOf(sourceFile, node.getEnd()),
        node,
        children: [],
      };

      if (kind === 'list') {
        const shape = listShape(mapCall(ts.isJsxExpression(node) ? node.expression : (node as ts.Expression))!, sourceFile);
        element.component = shape.ok ? shape.list.component : shape.component;
        return element;
      }

      if (kind === 'condition') {
        const shape = conditionShape((node as ts.JsxExpression).expression!, sourceFile);
        if (!shape.ok) return element;
        element.condition = shape.condition;
        element.children = build(
          shape.condition.branches.map((branch) => (branch.kind === 'list' ? listEntry(branch.node as ts.CallExpression) : toEntry(branch.node as JsxNode))),
          path,
        );
        return element;
      }

      if (kind === 'slot') {
        const initializer = (node as ts.JsxAttribute).initializer;
        const value = initializer && ts.isJsxExpression(initializer) && initializer.expression ? unwrap(initializer.expression) : initializer;
        element.children = build(jsxElements(value ? [value] : []).map(toEntry), path);
        return element;
      }

      const jsx = node as JsxNode;
      const opening = ts.isJsxElement(jsx) ? jsx.openingElement : jsx;
      element.layout = isLayout(opening.tagName);
      element.name = nameOf(opening, sourceFile);
      const slots = opening.attributes.properties.filter(
        (attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && jsxElements(slotValue(attribute)).length > 0,
      );
      element.children = build(
        [
          ...slots.map((attribute) => ({ tag: `@${attribute.name.getText(sourceFile)}`, node: attribute as ts.Node, kind: 'slot' as const })),
          ...(ts.isJsxElement(jsx) ? childEntries(jsx.children) : []),
        ],
        path,
      );
      return element;
    });
  };

  /** The elements and lists among JSX children, looking through fragments. */
  const childEntries = (children: readonly ts.JsxChild[]): { tag: string; node: ts.Node; kind: ElementNode['kind'] }[] =>
    children.flatMap((child) => {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) return [toEntry(child)];
      if (ts.isJsxFragment(child)) return childEntries(child.children);
      if (!ts.isJsxExpression(child) || !child.expression) return [];
      // A condition in its shape; one outside it is logic the commands don't see into (check reports it).
      if (isConditionExpression(child.expression)) {
        const shape = conditionShape(child.expression, sourceFile);
        return shape.ok ? [{ tag: `{?${shape.condition.test}}`, node: child as ts.Node, kind: 'condition' as const }] : [];
      }
      const call = mapCall(child.expression);
      return call ? [{ ...listEntry(call), node: child as ts.Node }] : [];
    });

  /** A list, by the variable it repeats over: "{links}". */
  const listEntry = (call: ts.CallExpression) => {
    const list = (call.expression as ts.PropertyAccessExpression).expression.getText(sourceFile);
    return { tag: `{${list}}`, node: call as ts.Node, kind: 'list' as const };
  };

  const toEntry = (node: JsxNode) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    return { tag: opening.tagName.getText(sourceFile), node: node as ts.Node, kind: 'element' as const };
  };

  const roots = build(jsxElements(returnedJsx(fn)).map(toEntry), '');
  const names = new Map<string, number>();
  for (const node of allNodes(roots)) if (node.name) names.set(node.name, (names.get(node.name) ?? 0) + 1);
  return { component: name, roots, sourceFile, names };
}

/** The JSX a prop holds: `footer={<Button />}` or `footer=<Button />`. */
function slotValue(attribute: ts.JsxAttribute): ts.Node[] {
  const initializer = attribute.initializer;
  if (!initializer) return [];
  if (ts.isJsxExpression(initializer)) return initializer.expression ? [unwrap(initializer.expression)] : [];
  return [initializer];
}

/** Every node of the tree, parents before children. */
export function allNodes(roots: ElementNode[]): ElementNode[] {
  return roots.flatMap((node) => [node, ...allNodes(node.children)]);
}

/**
 * The name of an element: the style its className uses, styles.<name>, also inside cx(styles.root, className)
 * or a template string. Undefined for an element without one.
 */
function nameOf(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement, sourceFile: ts.SourceFile): string | undefined {
  const attribute = opening.attributes.properties.find((property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(sourceFile) === 'className');
  let value: ts.Expression | undefined = attribute?.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
  if (value && ts.isCallExpression(value)) value = value.arguments[0];
  if (value && ts.isTemplateExpression(value)) value = value.templateSpans[0]?.expression;
  return value && ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === 'styles' ? value.name.text : undefined;
}
