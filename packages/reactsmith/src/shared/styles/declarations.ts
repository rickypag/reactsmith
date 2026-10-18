import { IssueError } from '../issues.js';

/** A CSS declaration: "gap", "9px". */
export type Declaration = [property: string, value: string];

const PROPERTY = /^(--[\w-]+|-?[a-z][a-z0-9-]*)$/;

function declarationsError(message: string): IssueError {
  return new IssueError({
    severity: 'error',
    code: 'css-invalid',
    message,
    hint: 'Pass declarations as in a CSS rule, e.g. "display: inline-flex; gap: 9px", with or without the { }.',
  });
}

/** Splits at `separator` outside parentheses and quotes, so "url(a;b)" and "'a;b'" stay whole. */
function splitTopLevel(text: string, separator: string): string[] {
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
    else if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  return [...parts, current];
}

/**
 * Parses CSS declarations as a design team hands them over: "display: inline-flex; gap: 9px",
 * optionally wrapped in { } and with comments. Values are kept as written, without any check.
 */
export function parseDeclarations(text: string): Declaration[] {
  const body = text.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/^\{([\s\S]*)\}$/, '$1');
  if (/[{}]/.test(body)) throw declarationsError('The CSS must be declarations only: selectors and nested rules are not supported.');

  const declarations: Declaration[] = [];
  for (const part of splitTopLevel(body, ';')) {
    if (!part.trim()) continue;
    const colon = part.indexOf(':');
    const property = colon === -1 ? '' : part.slice(0, colon).trim().toLowerCase();
    const value = colon === -1 ? '' : part.slice(colon + 1).trim().replace(/\s+/g, ' ');
    if (!PROPERTY.test(property) || !value) throw declarationsError(`"${part.trim()}" is not a CSS declaration.`);
    declarations.push([property, value]);
  }
  if (declarations.length === 0) throw declarationsError('No CSS declaration given.');
  return declarations;
}

/** "padding", "10px 14px" → "[padding:10px_14px]": a Tailwind arbitrary property, setting exactly that declaration. */
export function arbitraryProperty([property, value]: Declaration): string {
  return `[${property}:${value.replace(/_/g, '\\_').replace(/ /g, '_')}]`;
}

/** The Tailwind classes that already set `property`, so a new value replaces them instead of fighting them. */
export function tailwindClassesFor(property: string): RegExp {
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
  return new RegExp(`^(\\[${escaped}:.+\\]${utility ? `|${utility}` : ''})$`);
}
