import { IssueError } from '../issues.js';

/**
 * A value given to a command, such as --text or --href, split into text and variables:
 * "Hello, {user.name}!" → text "Hello, ", the name "user.name", text "!".
 */
export type ValuePart = { kind: 'text'; text: string } | { kind: 'name'; path: string; root: string };

/** A name or a property path: "label", "user.name", "link.href". */
const NAME_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

export function isNamePath(value: string): boolean {
  return NAME_PATH.test(value);
}

function valueError(code: string, message: string, hint: string): IssueError {
  return new IssueError({ severity: 'error', code, message, hint });
}

/**
 * Parses a value: "{name}" marks a variable, "\{" and "\}" are literal braces.
 * Only names and property paths go in braces: anything else must become a variable first.
 */
export function parseValue(value: string): ValuePart[] {
  const parts: ValuePart[] = [];
  let text = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (char === '\\' && (value[i + 1] === '{' || value[i + 1] === '}')) {
      text += value[++i];
      continue;
    }
    if (char !== '{') {
      text += char;
      continue;
    }
    const close = value.indexOf('}', i + 1);
    if (close === -1) throw valueError('value-brace-unclosed', `"${value}" has a "{" without its "}".`, 'Close the variable, e.g. "{label}", or write a literal brace as "\\{".');
    const path = value.slice(i + 1, close).trim();
    if (!NAME_PATH.test(path)) {
      throw valueError(
        'value-expression-not-allowed',
        `"{${value.slice(i + 1, close)}}" is not a variable: only names and property paths go in braces, e.g. {label} or {user.name}.`,
        'Compute the value in a variable first, e.g. "const date = formatDate(x)", and use {date}. Write a literal brace as "\\{".',
      );
    }
    if (text) parts.push({ kind: 'text', text });
    text = '';
    parts.push({ kind: 'name', path, root: path.split('.')[0]! });
    i = close;
  }
  if (text) parts.push({ kind: 'text', text });
  return parts;
}

/** The variables a value uses, each once: "user.name" and "user.id" both use "user". */
export function rootNames(parts: ValuePart[]): string[] {
  return [...new Set(parts.flatMap((part) => (part.kind === 'name' ? [part.root] : [])))];
}

/** Text as JSX: as written, or as a string expression when it has characters JSX would read as code. */
function jsxPlainText(text: string): string {
  return /[{}<>]/.test(text) ? `{${JSON.stringify(text)}}` : text;
}

/** A value as JSX children: "Hello, {user.name}!" stays as it is, literal braces become a string. */
export function jsxText(parts: ValuePart[]): string {
  return parts.map((part) => (part.kind === 'name' ? `{${part.path}}` : jsxPlainText(part.text))).join('');
}

/**
 * A value as a JSX attribute: href="/docs", href={link.href}, or href={`/docs/${slug}`}
 * when text and variables are mixed.
 */
export function jsxAttribute(name: string, parts: ValuePart[]): string {
  const [only] = parts;
  if (parts.length === 0) return `${name}=""`;
  if (parts.length === 1 && only!.kind === 'name') return `${name}={${only!.path}}`;
  if (parts.every((part) => part.kind === 'text')) {
    const value = parts.map((part) => (part as { text: string }).text).join('');
    return value.includes('"') ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`;
  }
  const template = parts.map((part) => (part.kind === 'name' ? `\${${part.path}}` : part.text.replace(/[`\\]|\$\{/g, (match) => `\\${match}`))).join('');
  return `${name}={\`${template}\`}`;
}
