import ts from 'typescript';
import { IssueError } from '../issues.js';

/** A CSS declaration: "gap", "9px". */
export type Declaration = [property: string, value: string];

/**
 * The states a style can have, written as `.name:hover` in CSS and `hover:` in Tailwind. "current" is the link
 * of the current page, which router links mark with aria-current="page": `.name[aria-current="page"]`. "pressed",
 * "selected" and "expanded" are the ARIA states of toggle buttons, tabs and menu buttons: `.name[aria-pressed="true"]`,
 * `aria-pressed:` in Tailwind. The last ones are parts of the element rather than states: `.name::placeholder`.
 */
export const STYLE_STATES = ['hover', 'focus-visible', 'focus-within', 'active', 'disabled', 'current', 'pressed', 'selected', 'expanded', 'placeholder', 'before', 'after'] as const;

/** The pseudo-elements among the states: "::placeholder", not ":placeholder". */
const PSEUDO_ELEMENTS: readonly StyleState[] = ['placeholder', 'before', 'after'];
export type StyleState = (typeof STYLE_STATES)[number];

/** The states that are ARIA attributes, and their selector. */
export const ARIA_STATES: Partial<Record<StyleState, string>> = {
  current: '[aria-current="page"]',
  pressed: '[aria-pressed="true"]',
  selected: '[aria-selected="true"]',
  expanded: '[aria-expanded="true"]',
};

/** The states a disabled element doesn't show: hovering or pressing a disabled button changes nothing. */
const ENABLED_ONLY: readonly StyleState[] = ['hover', 'active'];

/**
 * What follows the class in CSS: ":focus-visible", ":hover:not(:disabled)" (so a disabled button keeps its disabled
 * look, whatever the conditions on it), or '[aria-current="page"]' for "current".
 */
export function stateSelector(state: StyleState): string {
  const aria = ARIA_STATES[state];
  if (aria) return aria;
  if (PSEUDO_ELEMENTS.includes(state)) return `::${state}`;
  return ENABLED_ONLY.includes(state) ? `:${state}:not(:disabled)` : `:${state}`;
}

/** The Tailwind variant: "focus-visible", "not-disabled:hover", "aria-[current=page]" for "current", "aria-pressed". */
export function tailwindVariant(state: StyleState): string {
  if (state === 'current') return 'aria-[current=page]';
  if (ARIA_STATES[state]) return `aria-${state}`;
  return ENABLED_ONLY.includes(state) ? `not-disabled:${state}` : state;
}

/** Declarations for the element itself, and for each of its states. */
export interface StyleInput {
  base: Declaration[];
  states: Partial<Record<StyleState, Declaration[]>>;
}

const PROPERTY = /^(--[\w-]+|-?[a-z][a-z0-9-]*)$/;

function inputError(code: string, message: string, hint: string): IssueError {
  return new IssueError({ severity: 'error', code, message, hint });
}

const cssError = (message: string) =>
  inputError('css-invalid', message, 'Pass declarations as in a CSS rule, e.g. "display: inline-flex; gap: 9px", with or without the { }, and states as "&:hover { … }".');

/** A state as written in CSS for the messages: ":hover", "::placeholder", '[aria-current="page"]'. */
const writtenState = (state: StyleState) => stateSelector(state).replace(':not(:disabled)', '');

/** "&:hover", ":hover" → "hover", '&[aria-current="page"]' → "current"; undefined for any other selector. */
function stateOf(selector: string): StyleState | undefined {
  const bare = selector.trim().replace(/^&/, '');
  const aria = Object.entries(ARIA_STATES).find(([, attribute]) => attribute === bare.replace(/'/g, '"'));
  if (aria) return aria[0] as StyleState;
  // ":hover", and "::placeholder" for a pseudo-element (one colon is accepted too, as browsers do for ::before).
  const state = bare.replace(/^::?/, '');
  if (ARIA_STATES[state as StyleState]) return undefined;
  return (STYLE_STATES as readonly string[]).includes(state) ? (state as StyleState) : undefined;
}

function addState(input: StyleInput, state: StyleState, declarations: Declaration[]): void {
  input.states[state] = [...(input.states[state] ?? []), ...declarations];
}

/** One "property: value" declaration, checked. */
function declaration(text: string): Declaration {
  const colon = text.indexOf(':');
  const property = colon === -1 ? '' : text.slice(0, colon).trim().toLowerCase();
  const value = colon === -1 ? '' : text.slice(colon + 1).trim().replace(/\s+/g, ' ');
  if (!PROPERTY.test(property) || !value) throw cssError(`"${text.trim()}" is not a CSS declaration.`);
  return [property, value];
}

/**
 * Parses CSS as a design team hands it over: declarations, optionally wrapped in { }, with comments,
 * and nested state blocks such as "&:hover { … }". Values are kept as written, without any check.
 */
export function parseCss(text: string): StyleInput {
  let body = text.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  // A single wrapping { … } around everything is the rule's own braces.
  if (body.startsWith('{') && body.endsWith('}')) {
    let depth = 0;
    const closesAtEnd = [...body].every((char, index) => {
      if (char === '{') depth++;
      if (char === '}') depth--;
      return depth > 0 || index === body.length - 1;
    });
    if (closesAtEnd) body = body.slice(1, -1);
  }

  const input: StyleInput = { base: [], states: {} };
  let depth = 0;
  let quote: string | undefined;
  let current = '';
  let selector = '';
  for (const char of body) {
    if (quote) {
      if (char === quote) quote = undefined;
      current += char;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth === 0 && char === ';') {
      if (current.trim()) input.base.push(declaration(current));
      current = '';
      continue;
    }
    if (depth === 0 && char === '{') {
      selector = current;
      current = '';
      depth = 100; // inside a nested block: only its closing brace matters
      continue;
    }
    if (depth === 100 && char === '}') {
      const state = stateOf(selector);
      if (!state) throw cssError(`"${selector.trim()}" is not a supported state: use ${STYLE_STATES.map((s) => `&${writtenState(s)}`).join(', ')}.`);
      addState(input, state, splitDeclarations(current).map(declaration));
      current = '';
      depth = 0;
      continue;
    }
    if (char === '{' || char === '}') throw cssError('Only declarations and state blocks ("&:hover { … }") are supported: no other selectors or nested rules.');
    current += char;
  }
  if (depth !== 0) throw cssError('A state block is not closed.');
  if (current.trim()) input.base.push(declaration(current));
  if (input.base.length === 0 && Object.keys(input.states).length === 0) throw cssError('No CSS declaration given.');
  return input;
}

/** Splits declarations at ";" outside parentheses and quotes, so "url(a;b)" stays whole. */
function splitDeclarations(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = '';
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ';' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  return [...parts, current].filter((part) => part.trim());
}

/** React's unitless properties: their numbers stay numbers. Every other number is in px, as in the style prop. */
const UNITLESS = new Set([
  'animation-iteration-count', 'aspect-ratio', 'column-count', 'columns', 'fill-opacity', 'flex', 'flex-grow', 'flex-shrink',
  'font-weight', 'grid-area', 'grid-column', 'grid-row', 'line-clamp', 'line-height', 'opacity', 'order', 'orphans',
  'scale', 'stroke-opacity', 'tab-size', 'widows', 'z-index', 'zoom',
]);

/** "paddingInline" → "padding-inline", "WebkitTransition" → "-webkit-transition", "msFlex" → "-ms-flex". */
function kebab(key: string): string {
  if (key.startsWith('--')) return key;
  return key.replace(/^ms(?=[A-Z])/, '-ms').replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

const objectError = (message: string) =>
  inputError('style-object-invalid', message, "Pass an object as in React's style prop, e.g. { display: 'inline-flex', gap: 9, '&:hover': { opacity: 0.8 } }.");

function objectValue(key: string, node: ts.Expression, sourceFile: ts.SourceFile): string {
  const property = kebab(key);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  const negative = ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand);
  if (ts.isNumericLiteral(node) || negative) {
    const number = Number(node.getText(sourceFile));
    return number === 0 || UNITLESS.has(property) || property.startsWith('--') ? String(number) : `${number}px`;
  }
  throw objectError(`The value of "${key}" must be a string or a number, found "${node.getText(sourceFile)}".`);
}

/**
 * Parses a JavaScript style object, as in React's style prop: camelCase properties, numbers in px
 * (except unitless ones), and states as nested objects under "&:hover" or ":hover".
 */
export function parseStyleObject(text: string): StyleInput {
  const sourceFile = ts.createSourceFile('style.ts', `(${text.trim()});`, ts.ScriptTarget.Latest, true);
  const statement = sourceFile.statements[0];
  let expression = statement && ts.isExpressionStatement(statement) ? statement.expression : undefined;
  while (expression && ts.isParenthesizedExpression(expression)) expression = expression.expression;
  if (sourceFile.statements.length !== 1 || !expression || !ts.isObjectLiteralExpression(expression)) throw objectError('The style is not an object.');

  const input: StyleInput = { base: [], states: {} };
  const read = (object: ts.ObjectLiteralExpression, target: Declaration[], nested: boolean) => {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
        throw objectError(`"${property.getText(sourceFile)}" is not a "property: value" pair.`);
      }
      const key = property.name.text;
      if (ts.isObjectLiteralExpression(property.initializer)) {
        const state = stateOf(key);
        if (nested || !state) throw objectError(`"${key}" is not a supported state: use ${STYLE_STATES.map((s) => `'&${writtenState(s)}'`).join(', ')}.`);
        const declarations: Declaration[] = [];
        read(property.initializer, declarations, true);
        addState(input, state, declarations);
        continue;
      }
      target.push([kebab(key), objectValue(key, property.initializer, sourceFile)]);
    }
  };
  read(expression, input.base, false);
  if (input.base.length === 0 && Object.keys(input.states).length === 0) throw objectError('The style object is empty.');
  return input;
}

/** "padding", "10px 14px" → "[padding:10px_14px]": a Tailwind arbitrary property, setting exactly that declaration. */
export function arbitraryProperty([property, value]: Declaration, state?: StyleState): string {
  return `${state ? `${tailwindVariant(state)}:` : ''}[${property}:${value.replace(/_/g, '\\_').replace(/ /g, '_')}]`;
}

/** The Tailwind classes that already set `property` in `state`, so a new value replaces them instead of fighting them. */
export function tailwindClassesFor(property: string, state?: StyleState): RegExp {
  const escaped = property.replace(/[-]/g, '\\-');
  const utilities: Record<string, string> = {
    display: '(flex|inline-flex|block|inline-block|inline|grid|inline-grid|hidden|contents)',
    'flex-direction': 'flex-(row|col)(-reverse)?',
    gap: 'gap-.+',
    'align-items': 'items-.+',
    'justify-content': 'justify-.+',
    padding: 'p[xy]?-.+',
  };
  const utility = utilities[property];
  const prefix = state ? `${tailwindVariant(state).replace(/[[\]]/g, '\\$&')}:` : '';
  return new RegExp(`^${prefix}(\\[${escaped}:.+\\]${utility ? `|${utility}` : ''})$`);
}
