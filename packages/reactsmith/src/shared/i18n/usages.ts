import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { I18N_PRESETS } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { listFiles, toRelative } from '../files.js';
import { isCodeFile } from '../imports/specifiers.js';

/** Where the messages are used: each full key by the files showing it, and the groups read with a computed key. */
export interface MessageUsages {
  /** "TopBar.workshops" → the files calling t('workshops') with the TopBar translator. */
  keys: Map<string, string[]>;
  /** Groups read with a key computed at run time (t(link.label)): any key of the group may be in use. */
  dynamic: Map<string, string[]>;
  /** Each call with a literal key, where it is: what check reports a missing key at. */
  calls: { key: string; fileRel: string; line: number }[];
}

/** The server version of the hook, for async server components: getTranslations('TopBar'). */
const SERVER_HOOKS: Record<string, string> = { 'next-intl': 'getTranslations' };

/** The group a translator call reads, `useTranslations('TopBar')` → "TopBar", "" without one, undefined when not a translator. */
function translatorGroup(expression: ts.Expression | undefined, hooks: string[]): string | undefined {
  let call = expression;
  if (call && ts.isAwaitExpression(call)) call = call.expression;
  if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || !hooks.includes(call.expression.text)) return undefined;
  const [first] = call.arguments;
  if (!first) return '';
  if (ts.isStringLiteralLike(first)) return first.text;
  // getTranslations({ locale, namespace: 'TopBar' })
  if (ts.isObjectLiteralExpression(first)) {
    const namespace = first.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && property.name.getText() === 'namespace');
    if (namespace && ts.isStringLiteralLike(namespace.initializer)) return namespace.initializer.text;
  }
  return '';
}

/** The message usages of every code file of srcDir: translators declared with the library's hooks, and their calls. */
export async function messageUsages(root: string, config: ResolvedConfig): Promise<MessageUsages> {
  const usages: MessageUsages = { keys: new Map(), dynamic: new Map(), calls: [] };
  if (!config.i18n) return usages;
  const hooks = [I18N_PRESETS[config.i18n.library].hook, SERVER_HOOKS[config.i18n.library]].filter((hook): hook is string => !!hook);
  const add = (map: Map<string, string[]>, key: string, fileRel: string) => map.set(key, [...new Set([...(map.get(key) ?? []), fileRel])]);

  for (const file of (await listFiles(path.join(root, config.srcDir)).catch(() => [])).filter(isCodeFile).sort()) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (!hooks.some((hook) => text.includes(hook))) continue;
    const fileRel = toRelative(root, file);
    const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, /x$/.test(fileRel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    // The translators of the file, by name; a name declared twice keeps the last group, which is enough for components.
    const translators = new Map<string, string>();
    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const group = translatorGroup(node.initializer, hooks);
        if (group !== undefined) translators.set(node.name.text, group);
      }
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);
    if (translators.size === 0) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && translators.has(node.expression.text)) {
        const group = translators.get(node.expression.text)!;
        const [first] = node.arguments;
        if (first && ts.isStringLiteralLike(first)) {
          const key = group ? `${group}.${first.text}` : first.text;
          add(usages.keys, key, fileRel);
          usages.calls.push({ key, fileRel, line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1 });
        } else if (first) {
          add(usages.dynamic, group, fileRel);
        }
      }
      // t.rich('key', …), t.markup('key', …), t.has('key'): the same key.
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && translators.has(node.expression.expression.text)) {
        const group = translators.get(node.expression.expression.text)!;
        const [first] = node.arguments;
        if (first && ts.isStringLiteralLike(first)) add(usages.keys, group ? `${group}.${first.text}` : first.text, fileRel);
        else if (first) add(usages.dynamic, group, fileRel);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return usages;
}

/** Whether a key is used: shown with its literal key, or in a group read with computed keys. */
export function isUsed(usages: MessageUsages, key: string): string[] {
  const files = [...(usages.keys.get(key) ?? [])];
  for (const [group, groupFiles] of usages.dynamic) {
    if (group === '' || key === group || key.startsWith(`${group}.`)) files.push(...groupFiles);
  }
  return [...new Set(files)];
}
