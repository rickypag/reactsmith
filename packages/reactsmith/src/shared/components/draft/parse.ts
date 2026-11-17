import ts from 'typescript';
import { STYLE_STATES } from '../../styles/declarations.js';
import { ALIGNS, DIRECTIONS, JUSTIFIES } from '../../styles/layout.js';

/**
 * The draft of a component: the JSX it returns, written once, with `$` attributes for its styles. It is parsed into a
 * tree of the steps the element commands already do, so a draft is checked by the same code as those commands.
 * See design/component-jsx.md.
 */

/** A problem with the draft itself, before anything runs: a line of the draft and what to do. */
export interface DraftProblem {
  code: string;
  line: number;
  message: string;
  hint: string;
}

/** One `style update` from a `$css…` or `$class` attribute. */
export interface DraftStyleUpdate {
  line: number;
  /** The attribute as written: "$css-hover". */
  attribute: string;
  css?: string;
  classes?: string;
  state?: string;
  at?: string;
  when?: string;
}

/** The layout options of `$direction`, `$gap`, `$align`, `$justify` and `$padding`, as written. */
export type DraftLayout = Partial<Record<'direction' | 'gap' | 'align' | 'justify' | 'padding', string>>;

export interface DraftElement {
  kind: 'element';
  line: number;
  /** "article", "ProductCard", "SearchIcon". */
  tag: string;
  /** The attributes that are props, as JSX: 'src={image} alt={title}'. */
  props?: string;
  name?: string;
  from?: string;
  layout: DraftLayout;
  styles: DraftStyleUpdate[];
  /** The text, in --text form: "Hello, {user.name}!". */
  text?: string;
  /** A translated message's key: `{t('register')}` → "register". */
  message?: string;
  /** Children written before the text: inserted first, so the order of the draft is kept. */
  before: DraftChild[];
  /** Children after the text (or the root's {children}), or all of them when there is neither. */
  children: DraftChild[];
  /** The root only: it renders the component's `{children}`, after `before` and before `children`. */
  rendersChildren?: boolean;
  /** `{open && <nav />}`: "open"; "!open" for the opposite. */
  if?: string;
  /** `{label ?? <span />}`: "label". */
  fallback?: string;
  /** `{links.map((link) => <NavLink key={link.href} />)}`. */
  list?: { each: string; as: string; key: string };
}

/** `{test ? <A /> : <B />}`: the first branch is inserted with --if, the second into the condition. */
export interface DraftTernary {
  kind: 'ternary';
  line: number;
  test: string;
  whenTrue: DraftElement;
  whenFalse: DraftElement;
}

export type DraftChild = DraftElement | DraftTernary;

const LAYOUT_ATTRIBUTES = ['direction', 'gap', 'align', 'justify', 'padding'] as const;

/** The values the layout attributes take, as the options of the commands; gap and padding are read by the steps. */
const LAYOUT_VALUES: Record<string, readonly string[]> = { direction: DIRECTIONS, align: ALIGNS, justify: JUSTIFIES };

/** Attributes a draft never takes: styles go through `$` attributes. */
const REFUSED_PROPS: Record<string, string> = {
  className: 'Styles go through $ attributes: $name, $css, $gap…, or $class in a Tailwind project.',
  style: 'Styles go through $ attributes: $css="…" writes them in the style file.',
  ref: 'A ref is logic: add it by hand after the component is created.',
};

class DraftParser {
  readonly problems: DraftProblem[] = [];

  constructor(private readonly sourceFile: ts.SourceFile) {}

  /** The line of the draft a node starts on: the draft starts on the second line of the parsed text. */
  line(node: ts.Node): number {
    return this.sourceFile.getLineAndCharacterOfPosition(node.getStart(this.sourceFile)).line;
  }

  problem(node: ts.Node, code: string, message: string, hint: string): undefined {
    this.problems.push({ code, line: this.line(node), message, hint });
    return undefined;
  }

  text(node: ts.Node): string {
    return node.getText(this.sourceFile);
  }

  /** "open", "user.name": a name, the only value a draft computes nothing from. */
  isName(expression: ts.Expression): boolean {
    if (ts.isIdentifier(expression)) return true;
    return ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name) && this.isName(expression.expression);
  }

  /** `t('register')`: a message key, or undefined when the expression is something else. */
  messageKey(expression: ts.Expression): string | undefined {
    if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) return undefined;
    const [argument] = expression.arguments;
    return expression.arguments.length === 1 && argument && ts.isStringLiteral(argument) ? argument.text : undefined;
  }

  /** The root: one element, not a fragment, not a condition or a list. */
  root(expression: ts.Expression): DraftElement | undefined {
    const node = unwrap(expression);
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return this.element(node, false, true);
    if (ts.isJsxFragment(node)) return this.problem(node, 'draft-root-invalid', 'The draft is a fragment (<>…</>): a component has one root element.', 'Wrap the elements in one element, e.g. <div>…</div>.');
    return this.problem(node, 'draft-root-invalid', 'The draft must be one JSX element: the root of the component.', 'Write only what the component returns, e.g. <article>…</article>, without imports, a function or "return".');
  }

  element(node: ts.JsxElement | ts.JsxSelfClosingElement, inList = false, isRoot = false): DraftElement | undefined {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    const tag = this.text(opening.tagName);
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(tag)) {
      return this.problem(opening, 'draft-tag-invalid', `<${tag}> is not an element a draft can hold.`, 'Use an HTML tag ("div") or a component name ("ProductCard"); "M.Stack"-style names are not supported.');
    }
    const element: DraftElement = { kind: 'element', line: this.line(node), tag, layout: {}, styles: [], before: [], children: [] };
    const props: string[] = [];
    let key: string | undefined;
    for (const attribute of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) {
        props.push(this.text(attribute));
        continue;
      }
      const name = this.text(attribute.name);
      if (name.startsWith('$')) {
        this.styleAttribute(element, attribute, name);
        continue;
      }
      if (name === 'key') {
        if (!inList) this.problem(attribute, 'draft-key-outside-list', 'key is only for the items of a list.', 'Remove it: a list is written as {items.map((item) => <Item key={item.id} … />)}.');
        else key = this.keyOf(attribute);
        continue;
      }
      const refused = REFUSED_PROPS[name];
      if (refused) {
        this.problem(attribute, 'draft-attribute-invalid', `${name} is not written in a draft.`, refused);
        continue;
      }
      this.checkPropValue(attribute, name);
      props.push(this.text(attribute));
    }
    if (props.length) element.props = props.join(' ');
    if (inList) {
      if (key === undefined) this.problem(opening, 'draft-list-invalid', `<${tag}> repeats in a list but has no key.`, 'Give it a key from the item, e.g. key={item.id}.');
      element.list = { each: '', as: '', key: key ?? '' };
    }
    if (ts.isJsxElement(node)) this.children(element, node.children, isRoot);
    return element;
  }

  keyOf(attribute: ts.JsxAttribute): string | undefined {
    const initializer = attribute.initializer;
    if (initializer && ts.isJsxExpression(initializer) && initializer.expression && this.isName(initializer.expression)) return this.text(initializer.expression);
    return this.problem(attribute, 'draft-list-invalid', 'The key must be a value of the item, e.g. key={item.id}.', 'Use a field of the item that is unique in the list.');
  }

  /** Values a prop takes in a draft: literals, names, and messages; never functions or computed values. */
  checkPropValue(attribute: ts.JsxAttribute, name: string): void {
    const initializer = attribute.initializer;
    if (!initializer || ts.isStringLiteral(initializer) || !ts.isJsxExpression(initializer) || !initializer.expression) return;
    const expression = unwrap(initializer.expression);
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
      this.problem(attribute, 'draft-expression-invalid', `${name} is given a function: a draft holds no logic.`, `Write the function by hand before the return, e.g. "const handleClick = () => …", then pass ${name}={handleClick}.`);
    } else if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression)) {
      this.problem(attribute, 'draft-expression-invalid', `${name} is given JSX: props holding elements are not supported in a draft.`, 'Insert the element with "element insert" once the component exists, or write it by hand.');
    } else if (ts.isCallExpression(expression) && this.messageKey(expression) === undefined) {
      this.problem(attribute, 'draft-expression-invalid', `${name} is given a call: a draft holds no logic.`, `Compute the value by hand before the return, e.g. "const value = …", then pass ${name}={value}.`);
    }
  }

  styleAttribute(element: DraftElement, attribute: ts.JsxAttribute, name: string): void {
    const initializer = attribute.initializer;
    if (!initializer || !ts.isStringLiteral(initializer)) {
      this.problem(attribute, 'draft-style-attribute-invalid', `${name} takes a string, e.g. ${name}="…".`, 'Write the value in quotes, as on the command line.');
      return;
    }
    const value = initializer.text;
    const attributeName = name.slice(1);
    if (attributeName === 'name') element.name = value;
    else if (attributeName === 'from') element.from = value;
    else if ((LAYOUT_ATTRIBUTES as readonly string[]).includes(attributeName)) {
      const allowed = LAYOUT_VALUES[attributeName];
      if (allowed && !allowed.includes(value)) {
        this.problem(attribute, 'draft-style-attribute-invalid', `${name}="${value}" is not a value it takes.`, `Use one of: ${allowed.join(', ')}.`);
        return;
      }
      element.layout[attributeName as keyof DraftLayout] = value;
    }
    else if (attributeName === 'class') element.styles.push({ line: this.line(attribute), attribute: name, classes: value });
    else if (attributeName === 'css') element.styles.push({ line: this.line(attribute), attribute: name, css: value });
    else if (attributeName.startsWith('css-')) {
      const modifier = attributeName.slice('css-'.length);
      const update: DraftStyleUpdate = { line: this.line(attribute), attribute: name, css: value };
      if (modifier.startsWith('at-') && modifier.length > 3) update.at = modifier.slice(3);
      else if (modifier.startsWith('when-') && modifier.length > 5) {
        const condition = modifier.slice(5);
        const dash = condition.indexOf('-');
        update.when = dash === -1 ? condition : `${condition.slice(0, dash)}=${condition.slice(dash + 1)}`;
      } else if ((STYLE_STATES as readonly string[]).includes(modifier)) update.state = modifier;
      else {
        this.problem(attribute, 'draft-style-attribute-unknown', `${name} is not a style attribute.`, `After $css- comes a state (${STYLE_STATES.join(', ')}), "at-<breakpoint>" or "when-<prop>[-<value>]".`);
        return;
      }
      element.styles.push(update);
    } else {
      this.problem(attribute, 'draft-style-attribute-unknown', `${name} is not a style attribute.`, 'The $ attributes are $name, $from, $direction, $gap, $align, $justify, $padding, $css, $css-<state|at-…|when-…> and $class.');
    }
  }

  /** The children of an element: text (in one run), and elements, lists and conditions around it. */
  children(element: DraftElement, children: ts.NodeArray<ts.JsxChild>, isRoot: boolean): void {
    const textParts: string[] = [];
    let textNode: ts.Node | undefined;
    let textDone = false;
    const addText = (node: ts.Node, part: string) => {
      if (textDone) {
        this.problem(node, 'draft-text-split', `<${element.tag}> has text on both sides of an element.`, 'Keep the text of an element in one run, e.g. <button><SearchIcon />Search</button>; wrap other parts in their own text element, e.g. <span>.');
        return;
      }
      textNode ??= node;
      textParts.push(part);
    };
    // The text, or the root's {children}, is where the children split: those before it are inserted first.
    const anchored = () => textParts.length > 0 || element.rendersChildren === true;
    const addChild = (child: DraftChild | undefined) => {
      if (!child) return;
      if (textParts.length) textDone = true;
      (anchored() ? element.children : element.before).push(child);
    };

    for (const child of children) {
      if (ts.isJsxText(child)) {
        const cleaned = cleanJsxText(child.text);
        if (cleaned) addText(child, cleaned);
        continue;
      }
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
        addChild(this.element(child));
        continue;
      }
      if (ts.isJsxFragment(child)) {
        this.problem(child, 'draft-fragment', 'Fragments (<>…</>) are not written in a draft.', 'Put the elements directly in their parent, or in one element.');
        continue;
      }
      // A JSX expression: a name (text), a message, a list or a condition; comments are dropped.
      if (!child.expression) continue;
      const expression = unwrap(child.expression);
      if (ts.isIdentifier(expression) && expression.text === 'children') {
        if (!isRoot) this.problem(child, 'draft-children-invalid', '{children} is rendered by the root only.', 'Put {children} directly in the root element.');
        else if (element.rendersChildren) this.problem(child, 'draft-children-invalid', '{children} is rendered twice.', 'Keep one {children}.');
        else element.rendersChildren = true;
        continue;
      }
      if (this.isName(expression)) {
        addText(child, `{${this.text(expression)}}`);
        continue;
      }
      const key = this.messageKey(expression);
      if (key !== undefined) {
        if (element.message !== undefined || textParts.length) {
          this.problem(child, 'draft-message-invalid', `<${element.tag}> mixes a message with other text.`, "A translated text is the element's only text: put the rest in the message, or in another element.");
        } else element.message = key;
        continue;
      }
      if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        addText(child, expression.text);
        continue;
      }
      addChild(this.expressionChild(expression));
    }

    if (element.message !== undefined && (textParts.length || element.before.length || element.children.length)) {
      this.problem(textNode ?? children[0] ?? children, 'draft-message-invalid', `<${element.tag}> mixes a message with other children.`, 'A translated text is the only child of its element: wrap it in its own text element, e.g. <span>.');
    }
    if (element.rendersChildren && (textParts.length || element.message !== undefined)) {
      this.problem(textNode ?? children[0] ?? children, 'draft-children-invalid', 'The root renders {children} and text.', 'Put the text in its own element, e.g. <span>.');
    }
    if (textParts.length) element.text = textParts.join('');
    else if (!element.rendersChildren) {
      // Without text, every child goes in order: "before" only means "before the text".
      element.children = [...element.before, ...element.children];
      element.before = [];
    }
  }

  /** `{items.map(…)}`, `{open && <A />}`, `{open ? <A /> : <B />}`, `{label ?? <A />}`. */
  expressionChild(expression: ts.Expression): DraftChild | undefined {
    if (ts.isCallExpression(expression)) return this.list(expression);
    if (ts.isBinaryExpression(expression)) {
      const operator = expression.operatorToken.kind;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
        const test = this.test(expression.left, true);
        const branch = this.branch(expression.right);
        if (test === undefined || !branch) return undefined;
        if (branch.if !== undefined || branch.fallback !== undefined) return this.problem(expression, 'draft-condition-invalid', "Conditions don't nest.", 'Combine the tests in a variable written by hand, e.g. "const show = open && ready".');
        return { ...branch, if: test };
      }
      if (operator === ts.SyntaxKind.QuestionQuestionToken) {
        const test = this.test(expression.left, false);
        const branch = this.branch(expression.right);
        if (test === undefined || !branch) return undefined;
        return { ...branch, fallback: test };
      }
      if (operator === ts.SyntaxKind.BarBarToken) {
        return this.problem(expression, 'draft-condition-invalid', '"||" is not written in a draft.', 'Use "??" for a fallback: {label ?? <span>None</span>}.');
      }
    }
    if (ts.isConditionalExpression(expression)) {
      const test = this.test(expression.condition, false);
      const whenTrue = unwrap(expression.whenTrue);
      const whenFalse = unwrap(expression.whenFalse);
      if (test === undefined) return undefined;
      // `open ? <A /> : null` is `open && <A />`; `open ? null : <A />` is `!open && <A />`.
      if (whenFalse.kind === ts.SyntaxKind.NullKeyword) {
        const branch = this.branch(whenTrue);
        return branch && { ...branch, if: test };
      }
      if (whenTrue.kind === ts.SyntaxKind.NullKeyword) {
        const branch = this.branch(whenFalse);
        return branch && { ...branch, if: `!${test}` };
      }
      const a = this.branch(whenTrue);
      const b = this.branch(whenFalse);
      if (!a || !b) return undefined;
      return { kind: 'ternary', line: this.line(expression), test, whenTrue: a, whenFalse: b };
    }
    return this.problem(
      expression,
      'draft-expression-invalid',
      `{${this.text(expression)}} is computed: a draft only shows names, lists and conditions.`,
      'Compute it by hand before the return, e.g. "const count = items.length", then show {count}.',
    );
  }

  test(expression: ts.Expression, negation: boolean): string | undefined {
    const node = unwrap(expression);
    if (this.isName(node)) return this.text(node);
    if (negation && ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken && this.isName(unwrap(node.operand))) return `!${this.text(unwrap(node.operand))}`;
    return this.problem(node, 'draft-condition-invalid', `"${this.text(node)}" is not a name to test.`, `Test a prop or a variable${negation ? ', or "!name"' : ''}; compute anything else by hand first, e.g. "const hasItems = items.length > 0".`);
  }

  /** A branch of a condition: one element or one list. */
  branch(expression: ts.Expression): DraftElement | undefined {
    const node = unwrap(expression);
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return this.element(node);
    if (ts.isCallExpression(node)) return this.list(node);
    return this.problem(node, 'draft-condition-invalid', 'Each branch of a condition is one element or one list.', 'Wrap several elements in one, e.g. <div>…</div>; conditions do not nest.');
  }

  /** `{links.map((link) => <NavLink key={link.href} {...link} />)}`. */
  list(call: ts.CallExpression): DraftElement | undefined {
    const callee = call.expression;
    const invalid = () =>
      this.problem(call, 'draft-list-invalid', `{${this.text(call).slice(0, 40)}…} is not a list a draft can hold.`, 'A list is {items.map((item) => <Item key={item.id} … />)}: one item name, and one component with a key.');
    if (!ts.isPropertyAccessExpression(callee) || this.text(callee.name) !== 'map' || !this.isName(callee.expression)) {
      if (this.messageKey(call) !== undefined) return this.problem(call, 'draft-message-invalid', 'A message is the only child of its element.', 'Wrap it in a text element, e.g. <span>{t(\'key\')}</span>.');
      return this.problem(call, 'draft-expression-invalid', `{${this.text(call)}} is a call: a draft only shows names, lists and conditions.`, 'Compute the value by hand before the return, then show it by its name.');
    }
    const [callback] = call.arguments;
    if (call.arguments.length !== 1 || !callback || !ts.isArrowFunction(callback) || callback.parameters.length !== 1) return invalid();
    const parameter = callback.parameters[0]!;
    if (!ts.isIdentifier(parameter.name)) return invalid();
    const body = ts.isBlock(callback.body) ? undefined : unwrap(callback.body);
    if (!body || !(ts.isJsxElement(body) || ts.isJsxSelfClosingElement(body))) return invalid();
    const item = this.element(body, true);
    if (!item) return undefined;
    if (item.before.length || item.children.length || item.text !== undefined || item.message !== undefined) {
      return this.problem(body, 'draft-list-invalid', `<${item.tag}> in a list holds children.`, 'The item of a list is one component with props: what it shows goes in that component.');
    }
    item.list = { each: this.text(callee.expression), as: parameter.name.text, key: item.list!.key };
    return item;
  }
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/** JSX's whitespace rules: lines are trimmed, blank lines dropped, and the rest joined by a space. */
export function cleanJsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = -1;
  lines.forEach((line, index) => {
    if (/[^ \t]/.test(line)) lastNonEmpty = index;
  });
  let result = '';
  lines.forEach((line, index) => {
    let trimmed = line.replace(/\t/g, ' ');
    if (index !== 0) trimmed = trimmed.replace(/^ +/, '');
    if (index !== lines.length - 1) trimmed = trimmed.replace(/ +$/, '');
    if (!trimmed) return;
    result += index === lastNonEmpty ? trimmed : `${trimmed} `;
  });
  return result;
}

/** Parses a draft: its root element, or the problems found, each with its line. */
export function parseDraft(draft: string): { root?: DraftElement; problems: DraftProblem[] } {
  // The draft starts on line 1 of the parsed text, so a node's 0-based line is its line in the draft.
  const sourceFile = ts.createSourceFile('draft.tsx', `const draft = (\n${draft}\n);\n`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics = (sourceFile as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
  if (diagnostics.length) {
    return {
      problems: diagnostics.map((diagnostic) => ({
        code: 'draft-syntax',
        line: sourceFile.getLineAndCharacterOfPosition(diagnostic.start).line,
        message: `The draft is not valid JSX: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
        hint: 'Write one JSX element, as the component would return it.',
      })),
    };
  }
  const statement = sourceFile.statements[0];
  const declaration = statement && ts.isVariableStatement(statement) ? statement.declarationList.declarations[0] : undefined;
  const parser = new DraftParser(sourceFile);
  if (sourceFile.statements.length !== 1 || !declaration?.initializer) {
    return { problems: [{ code: 'draft-root-invalid', line: 1, message: 'The draft must be one JSX element: the root of the component.', hint: 'Write only what the component returns, without imports, a function or "return".' }] };
  }
  const root = parser.root(declaration.initializer);
  const rootNode = unwrap(declaration.initializer);
  if (root && (root.list || root.if !== undefined || root.fallback !== undefined)) parser.problem(rootNode, 'draft-root-invalid', 'The root is always shown.', 'Put the list or the condition inside the root element.');
  if (root?.name !== undefined) parser.problem(rootNode, 'draft-root-name', 'The root has no $name: its style is always "root".', 'Remove $name from the root.');
  return { root: parser.problems.length ? undefined : root, problems: parser.problems };
}
