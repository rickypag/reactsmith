import ts from 'typescript';
import type { LayoutClassifier } from '../layout/classify.js';

export interface Position {
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

/**
 * A JSX element of a component, or a slot: a prop holding JSX, such as `footer={<Button />}`,
 * whose segment is "@footer" and whose children are the elements passed in it.
 */
export interface ElementNode {
  kind: 'element' | 'slot';
  /** The tag as written ("Stack", "M.Stack", "nav"), or "@footer" for a slot. */
  tag: string;
  /** The tag, with "[n]" when siblings share it: "ListItem[2]". */
  segment: string;
  /** Segments from the component's root: "Stack/nav/ListItem[2]". */
  path: string;
  /** Whether it is a layout component, so other elements can be inserted into it. */
  layout: boolean;
  start: Position;
  end: Position;
  node: ts.Node;
  children: ElementNode[];
}

export interface ElementTree {
  /** The component the file defines. */
  component: string;
  /** The elements the component returns: usually one. */
  roots: ElementNode[];
  sourceFile: ts.SourceFile;
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
function componentFunction(sourceFile: ts.SourceFile, name: string): ts.ArrowFunction | undefined {
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

      if (kind === 'slot') {
        const initializer = (node as ts.JsxAttribute).initializer;
        const value = initializer && ts.isJsxExpression(initializer) && initializer.expression ? unwrap(initializer.expression) : initializer;
        element.children = build(jsxElements(value ? [value] : []).map(toEntry), path);
        return element;
      }

      const jsx = node as JsxNode;
      const opening = ts.isJsxElement(jsx) ? jsx.openingElement : jsx;
      element.layout = isLayout(opening.tagName);
      const slots = opening.attributes.properties.filter(
        (attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && jsxElements(slotValue(attribute)).length > 0,
      );
      element.children = build(
        [
          ...slots.map((attribute) => ({ tag: `@${attribute.name.getText(sourceFile)}`, node: attribute as ts.Node, kind: 'slot' as const })),
          ...(ts.isJsxElement(jsx) ? jsxElements(jsx.children).map(toEntry) : []),
        ],
        path,
      );
      return element;
    });
  };

  const toEntry = (node: JsxNode) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    return { tag: opening.tagName.getText(sourceFile), node: node as ts.Node, kind: 'element' as const };
  };

  return { component: name, roots: build(jsxElements(returnedJsx(fn)).map(toEntry), ''), sourceFile };
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
