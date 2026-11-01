import ts from 'typescript';
import { IssueError } from '../issues.js';

export interface ParsedProps {
  /** Each member as written, without a trailing separator: "items: NavItem[]", "collapsed?: boolean". */
  members: string[];
  /** The prop names: "items", "collapsed". */
  names: string[];
  /** Type names the props use that are not built in, e.g. "NavItem": they get placeholders. */
  unknownTypes: string[];
  /** The default value of each prop that has one, as written: "showName?: boolean = true" → { showName: "true" }. */
  defaults: Record<string, string>;
}

/** Types available without an import: TypeScript's built-ins and common DOM types. React's live under "React.". */
const GLOBAL_TYPES = new Set([
  'Array', 'ReadonlyArray', 'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude', 'Extract',
  'NonNullable', 'ReturnType', 'Parameters', 'Awaited', 'Promise', 'Date', 'Map', 'Set', 'ReadonlyMap', 'ReadonlySet',
  'RegExp', 'Error', 'Function', 'Element', 'Node', 'Event', 'File', 'Blob', 'URL', 'FormData',
]);
const DOM_TYPE = /^(HTML\w*Element|\w+Event)$/;

function propsError(message: string, hint: string): IssueError {
  return new IssueError({ severity: 'error', code: 'props-invalid', message, hint });
}

/**
 * Takes the default values out of props written as interface members: "open?: boolean = true; size: Size" →
 * "open?: boolean; size: Size" and { open: "true" }. A default starts at an "=" outside brackets ("=>" is a function
 * type) and ends where the member does: at ";", "," or a new line outside brackets.
 */
function takeDefaults(text: string): { text: string; defaults: Record<string, string> } {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const tokens: { kind: ts.SyntaxKind; start: number; end: number; newLine: boolean }[] = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    tokens.push({ kind, start: scanner.getTokenStart(), end: scanner.getTokenEnd(), newLine: scanner.hasPrecedingLineBreak() });
  }
  const opening = new Set([ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.OpenBracketToken, ts.SyntaxKind.OpenBraceToken]);
  const closing = new Set([ts.SyntaxKind.CloseParenToken, ts.SyntaxKind.CloseBracketToken, ts.SyntaxKind.CloseBraceToken]);
  const separator = (index: number) => tokens[index]!.kind === ts.SyntaxKind.SemicolonToken || tokens[index]!.kind === ts.SyntaxKind.CommaToken;
  // A member starts after a separator, or on a new line that starts with "name:" or "name?:".
  const startsMember = (index: number) => {
    const next = tokens[index + 1]?.kind;
    return tokens[index]!.newLine && tokens[index]!.kind === ts.SyntaxKind.Identifier && (next === ts.SyntaxKind.ColonToken || next === ts.SyntaxKind.QuestionToken);
  };
  const defaults: Record<string, string> = {};
  const cuts: [number, number][] = [];
  let depth = 0;
  let memberStart = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (depth === 0 && (startsMember(index) || (index > 0 && separator(index - 1)))) memberStart = token.start;
    if (opening.has(token.kind)) depth++;
    else if (closing.has(token.kind)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && token.kind === ts.SyntaxKind.EqualsToken) {
      let end = index + 1;
      for (let inner = 0; end < tokens.length; end++) {
        if (inner === 0 && (separator(end) || startsMember(end))) break;
        if (opening.has(tokens[end]!.kind)) inner++;
        else if (closing.has(tokens[end]!.kind)) inner = Math.max(0, inner - 1);
      }
      const last = tokens[end - 1]!;
      const name = /^\s*([A-Za-z_$][\w$]*)/.exec(text.slice(memberStart, token.start))?.[1];
      const value = text.slice(token.end, last.end).trim();
      if (!name || end === index + 1) throw propsError(`"${text.slice(memberStart, last.end).trim()}" has no default value after "=".`, 'Write the default after the type, e.g. "open?: boolean = true".');
      defaults[name] = value;
      cuts.push([token.start, last.end]);
      index = end - 1;
    }
  }
  const rest = cuts.reduceRight((updated, [start, end]) => `${updated.slice(0, start).replace(/\s+$/, '')}${updated.slice(end)}`, text);
  return { text: rest, defaults };
}

/** A member of a props interface as written in the file, its default value as a JSDoc tag above it. */
export function interfaceMember(member: string, defaultValue?: string, indent = '  '): string {
  return defaultValue === undefined ? `${indent}${member};` : `${indent}/** @default ${defaultValue} */\n${indent}${member};`;
}

/** The default values the props interface of a component gives in JSDoc ("@default true"), by prop. */
export function interfaceDefaults(sourceFile: ts.SourceFile, component: string): Map<string, string> {
  const declaration = sourceFile.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === `${component}Props`);
  const defaults = new Map<string, string>();
  for (const member of declaration?.members ?? []) {
    const tag = ts.getJSDocTags(member).find((candidate) => candidate.tagName.text === 'default');
    const value = tag && ts.getTextOfJSDocComment(tag.comment)?.trim();
    if (value && member.name && ts.isIdentifier(member.name)) defaults.set(member.name.text, value);
  }
  return defaults;
}

/**
 * Parses props written as TypeScript interface members, separated by ";", "," or new lines:
 * "items: NavItem[]; collapsed?: boolean; onSelect: (id: string) => void". An optional prop may have a default
 * value after its type: "showName?: boolean = true".
 */
export function parseProps(written: string): ParsedProps {
  const { text, defaults } = takeDefaults(written);
  const source = `interface Props {\n${text}\n}`;
  const { diagnostics } = ts.transpileModule(source, { reportDiagnostics: true });
  const sourceFile = ts.createSourceFile('props.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = sourceFile.statements[0];
  if (diagnostics?.length || sourceFile.statements.length !== 1 || !declaration || !ts.isInterfaceDeclaration(declaration)) {
    const reason = diagnostics?.[0] ? `: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ')}` : '';
    throw propsError(`The props are not valid TypeScript${reason}.`, 'Write them like interface members: "items: NavItem[]; collapsed?: boolean".');
  }

  const members: string[] = [];
  const names = new Set<string>();
  const typeParameters = new Set<string>();
  const referenced = new Set<string>();

  for (const member of declaration.members) {
    if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) {
      throw propsError(`"${member.getText(sourceFile)}" is not a prop.`, 'Each prop is "name: type" or "name?: type".');
    }
    if (!ts.isIdentifier(member.name)) {
      throw propsError(`"${member.name.getText(sourceFile)}" is not a valid prop name.`, 'Use a name like "items" or "onSelect".');
    }
    if (names.has(member.name.text)) throw propsError(`The prop "${member.name.text}" is declared twice.`, 'Remove one of them.');
    names.add(member.name.text);
    const defaultValue = defaults[member.name.text];
    if (defaultValue !== undefined) {
      if (!member.questionToken) throw propsError(`"${member.name.text}" has a default value, so it is optional.`, `Make it optional: "${member.name.text}?: <type> = ${defaultValue}".`);
      const check = ts.transpileModule(`const value = (${defaultValue});`, { reportDiagnostics: true });
      if (check.diagnostics?.length || /[;\n]/.test(defaultValue)) throw propsError(`"${defaultValue}" is not a value.`, 'Write the default as a value, e.g. "= true", "= \'md\'" or "= 2".');
    }
    members.push(member.getText(sourceFile).replace(/[;,]$/, ''));

    const visit = (node: ts.Node): void => {
      if (ts.isTypeParameterDeclaration(node)) typeParameters.add(node.name.text);
      if (ts.isTypeReferenceNode(node)) {
        if (ts.isIdentifier(node.typeName)) {
          referenced.add(node.typeName.text);
        } else if (node.typeName.getText(sourceFile).split('.')[0] !== 'React') {
          throw propsError(`"${node.typeName.getText(sourceFile)}" cannot be given a placeholder.`, 'Use a plain type name; you can import the real type afterwards.');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(member);
  }

  const unknownTypes = [...referenced].filter((name) => !GLOBAL_TYPES.has(name) && !DOM_TYPE.test(name) && !typeParameters.has(name)).sort();
  const unused = Object.keys(defaults).filter((name) => !names.has(name));
  if (unused.length) throw propsError(`The default of "${unused[0]}" belongs to no prop.`, 'Write the default after the prop\'s type, e.g. "open?: boolean = true".');
  return { members, names: [...names], unknownTypes, defaults };
}
