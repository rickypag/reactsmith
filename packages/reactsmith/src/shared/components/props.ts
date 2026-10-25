import ts from 'typescript';
import { IssueError } from '../issues.js';

export interface ParsedProps {
  /** Each member as written, without a trailing separator: "items: NavItem[]", "collapsed?: boolean". */
  members: string[];
  /** The prop names: "items", "collapsed". */
  names: string[];
  /** Type names the props use that are not built in, e.g. "NavItem": they get placeholders. */
  unknownTypes: string[];
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
 * Parses props written as TypeScript interface members, separated by ";", "," or new lines:
 * "items: NavItem[]; collapsed?: boolean; onSelect: (id: string) => void".
 */
export function parseProps(text: string): ParsedProps {
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
  return { members, names: [...names], unknownTypes };
}
