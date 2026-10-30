import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { ResolvedConfig } from '../config/types.js';
import { cssRules } from '../styles/remove.js';
import { styleFileOf } from '../styles/remove.js';
import { elementId, loadFileTree } from './ids.js';
import type { ElementNode, ElementTree } from './tree.js';

/** An element of a file as data: what the commands write, so a program can compare it with a design. */
export interface ElementDescription {
  /** The id to pass to the commands: "…/Panel.tsx#title". */
  id: string;
  kind: ElementNode['kind'];
  /** "h2", "CodeBlock", "{links}" for a list, "{?open}" for a condition, "@footer" for a prop holding JSX. */
  tag: string;
  /** Its style: className={styles.<name>}. */
  name?: string;
  /** The text it shows, as written: words and {values}, without the elements inside it. */
  text?: string;
  /** Its props as written, without className and key: string literals as their value, others as {code}. */
  props?: Record<string, string>;
  /** The declarations of its style's own rule (".name { … }"), when the style file is CSS. */
  style?: Record<string, string>;
  /** For a list: the component it repeats; for a condition: its operator and test. */
  component?: string;
  condition?: { operator: string; test: string };
  children: ElementDescription[];
}

export interface FileDescription {
  /** Project-relative path of the file. */
  file: string;
  component: string;
  /** Project-relative path of its style file, when it has one. */
  styleFile?: string;
  roots: ElementDescription[];
}

/** The declarations of each class's own rule in a CSS module: ".title { … }", not ".title:hover" or nested ones. */
function ownRules(css: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  for (const rule of cssRules(css)) {
    const name = /^\.(-?[_a-zA-Z][\w-]*)$/.exec(rule.selector)?.[1];
    if (!name) continue;
    const body = css.slice(css.indexOf('{', rule.start) + 1, rule.end - 1).replace(/\{[^{}]*\}/g, '');
    const declarations: Record<string, string> = {};
    for (const part of body.split(';')) {
      const colon = part.indexOf(':');
      if (colon === -1 || part.slice(0, colon).includes('&')) continue;
      const property = part.slice(0, colon).trim();
      if (property) declarations[property] = part.slice(colon + 1).trim();
    }
    rules.set(name, declarations);
  }
  return rules;
}

function describeNode(node: ElementNode, tree: ElementTree, srcRel: string, rules: Map<string, Record<string, string>>): ElementDescription {
  const sourceFile = tree.sourceFile;
  const description = { id: elementId(srcRel, node, tree), kind: node.kind, tag: node.tag } as ElementDescription;
  if (node.name) description.name = node.name;
  if (node.kind === 'list' && node.component) description.component = node.component;
  if (node.kind === 'condition' && node.condition) description.condition = { operator: node.condition.operator, test: node.condition.test };

  const jsx = node.node;
  if (node.kind === 'element' && (ts.isJsxElement(jsx) || ts.isJsxSelfClosingElement(jsx))) {
    const opening = ts.isJsxElement(jsx) ? jsx.openingElement : jsx;
    const props: Record<string, string> = {};
    for (const attribute of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) {
        props['...'] = attribute.expression.getText(sourceFile);
        continue;
      }
      const name = attribute.name.getText(sourceFile);
      if (name === 'className' || name === 'key') continue;
      const value = attribute.initializer;
      props[name] = !value ? 'true' : ts.isStringLiteral(value) ? value.text : value.getText(sourceFile);
    }
    if (Object.keys(props).length) description.props = props;
    if (ts.isJsxElement(jsx)) {
      const text = jsx.children
        .filter((child) => ts.isJsxText(child) || (ts.isJsxExpression(child) && child.expression && !node.children.some((element) => element.node === child)))
        .map((child) => (ts.isJsxText(child) ? child.text : child.getText(sourceFile)))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) description.text = text;
    }
  }
  if (node.name && rules.has(node.name)) description.style = rules.get(node.name);
  description.children = node.children.map((child) => describeNode(child, tree, srcRel, rules));
  return description;
}

/** Describes the elements of a component, view or layout file, with the declarations of their styles. */
export async function describeFile(root: string, config: ResolvedConfig, file: string): Promise<FileDescription> {
  const { srcRel, rootRel, tree } = await loadFileTree(root, config, file);
  const styleRel = styleFileOf(config, rootRel);
  const css = config.styles === 'css-modules' ? await readFile(path.join(root, styleRel), 'utf8').catch(() => undefined) : undefined;
  const rules = css === undefined ? new Map<string, Record<string, string>>() : ownRules(css);
  return {
    file: rootRel,
    component: tree.component,
    ...(css === undefined ? {} : { styleFile: styleRel }),
    roots: tree.roots.map((node) => describeNode(node, tree, srcRel, rules)),
  };
}
