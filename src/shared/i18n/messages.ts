import { readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { addNamedImport } from '../code/insert.js';
import { CONFIG_FILE, I18N_PRESETS, TOOL_NAME, TRANSLATOR_NAME } from '../config/defaults.js';
import type { I18nConfig, ResolvedConfig } from '../config/types.js';
import { componentFunction } from '../elements/tree.js';
import { IssueError } from '../issues.js';
import { addBodyStatements } from '../values/placeholders.js';

/**
 * Translations: one message file per language (messages/en.json), its keys grouped by component, as nested JSON:
 *
 *   { "TopBar": { "workshops": "Workshops", "register": "Register" } }
 *
 * A component gets its translator once, named after it (const t = useTranslations('TopBar')), and shows a message
 * with its key inside the group: {t('workshops')}. The full key, "TopBar.workshops", is the one the files hold.
 */

/** A message file's content: groups of keys, and texts at the end. */
export interface Messages {
  [key: string]: string | Messages;
}

/** One segment of a key: "TopBar", "workshops", "nav-links", "item_1". */
const SEGMENT = /^[A-Za-z0-9_-]+$/;

function i18nError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** The translation settings, or a refusal saying how to set them up. */
export function requireI18n(config: ResolvedConfig): I18nConfig {
  if (config.i18n) return config.i18n;
  throw i18nError(
    'i18n-not-configured',
    'The app has no translations set up.',
    `Install the translation library (next-intl), set it up, then run "${TOOL_NAME} init", which writes "i18n" in ${CONFIG_FILE}.`,
    CONFIG_FILE,
  );
}

/** "TopBar.workshops" → ["TopBar", "workshops"], refusing keys that can't be a path of a message file. */
export function keyPath(key: string): string[] {
  const keys = key.trim().split('.');
  if (keys.some((segment) => !SEGMENT.test(segment))) {
    throw i18nError('message-key-invalid', `"${key}" is not a message key.`, 'A key is names separated by dots, of letters, digits, "-" and "_", e.g. "TopBar.workshops".');
  }
  return keys;
}

/** The message file of a language, from the project root: "messages/it.json". */
export function messagesFile(i18n: I18nConfig, locale: string): string {
  return i18n.messages.replace('{locale}', locale);
}

/** The languages of the app: the message files that exist, the default one first. */
export async function listLocales(root: string, i18n: I18nConfig): Promise<string[]> {
  const dirRel = path.posix.dirname(i18n.messages);
  const [before, after] = path.posix.basename(i18n.messages).split('{locale}') as [string, string];
  const entries = await readdir(path.join(root, dirRel)).catch(() => [] as string[]);
  const locales = entries
    .filter((name) => name.startsWith(before) && name.endsWith(after) && name.length > before.length + after.length)
    .map((name) => name.slice(before.length, name.length - after.length))
    .sort();
  return [...new Set([i18n.defaultLocale, ...locales])].filter((locale) => locale === i18n.defaultLocale || locales.includes(locale));
}

/** Reads a message file, as planned so far: undefined when it doesn't exist, a refusal when it isn't messages. */
export async function readMessages(read: (fileRel: string) => Promise<string | undefined>, fileRel: string): Promise<Messages | undefined> {
  const text = await read(fileRel);
  if (text === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw i18nError('messages-invalid', `${fileRel} is not valid JSON: ${(error as Error).message}.`, 'Fix the JSON: the commands read and write it.', fileRel);
  }
  const check = (value: unknown, keys: string[]): void => {
    if (typeof value === 'string') return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw i18nError('messages-invalid', `"${keys.join('.')}" in ${fileRel} is neither a text nor a group of keys.`, 'A message is a string; a group is an object of messages.', fileRel);
    }
    for (const [key, inner] of Object.entries(value)) check(inner, [...keys, key]);
  };
  check(raw, []);
  if (typeof raw !== 'object') throw i18nError('messages-invalid', `${fileRel} must hold an object of messages.`, 'E.g. { "TopBar": { "workshops": "Workshops" } }.', fileRel);
  return raw as Messages;
}

/** The text of a key, or undefined. A group is not a text. */
export function messageAt(messages: Messages, keys: string[]): string | undefined {
  let value: string | Messages | undefined = messages;
  for (const key of keys) value = typeof value === 'object' ? value[key] : undefined;
  return typeof value === 'string' ? value : undefined;
}

/** Every full key of a file with its text: "TopBar.workshops" → "Workshops". */
export function allMessages(messages: Messages, prefix: string[] = []): Map<string, string> {
  const found = new Map<string, string>();
  for (const [key, value] of Object.entries(messages)) {
    if (typeof value === 'string') found.set([...prefix, key].join('.'), value);
    else for (const [inner, text] of allMessages(value, [...prefix, key])) found.set(inner, text);
  }
  return found;
}

/** A message file as the commands write it. */
export function serializeMessages(messages: Messages): string {
  return `${JSON.stringify(messages, null, 2)}\n`;
}

/**
 * The key a component shows must be in the default language: the element shows a message, never a key without text.
 * Returns the full key, "TopBar.workshops".
 */
export async function requireMessage(changes: ChangeSet, config: ResolvedConfig, component: string, key: string, file: string): Promise<string> {
  const i18n = requireI18n(config);
  const full = [component, ...keyPath(key)].join('.');
  const fileRel = messagesFile(i18n, i18n.defaultLocale);
  const messages = (await readMessages((rel) => changes.read(rel), fileRel)) ?? {};
  if (messageAt(messages, full.split('.')) === undefined) {
    throw i18nError(
      'message-missing',
      `"${full}" is not in ${fileRel}: ${component} shows the messages of its group "${component}".`,
      `Add its text first: "${TOOL_NAME} messages --set \\"${full}=…\\" --locale ${i18n.defaultLocale}".`,
      file,
    );
  }
  return full;
}

/**
 * Checks the messages given to props, label={t('kicker')}, as --message checks its key: the app is translated, the
 * call is the component's translator (its own name, or "t" when it has none yet), and the key is in its group.
 */
export async function requirePropMessages(changes: ChangeSet, config: ResolvedConfig, sourceFile: ts.SourceFile, component: string, messages: { translator: string; key: string }[], file: string): Promise<void> {
  if (!messages.length) return;
  const i18n = requireI18n(config);
  const translator = translatorOf(sourceFile, component, i18n)?.name ?? TRANSLATOR_NAME;
  for (const { translator: called, key } of messages) {
    if (called !== translator) {
      throw i18nError(
        'value-expression-not-allowed',
        `"${called}('${key}')" calls a function: only variables, literals and the component's messages (${translator}('…')) are allowed.`,
        `For a message of ${component}, write ${translator}('${key}'). Otherwise compute the value in a variable first and pass it by name.`,
        file,
      );
    }
    await requireMessage(changes, config, component, key, file);
  }
}

/** The translator of the component, as declared in its body: `const t = useTranslations('TopBar')` → "t". */
export function translatorOf(sourceFile: ts.SourceFile, component: string, i18n: I18nConfig): { name: string; namespace: string | undefined } | undefined {
  const fn = componentFunction(sourceFile, component);
  if (!fn || !ts.isBlock(fn.body)) return undefined;
  const hook = I18N_PRESETS[i18n.library].hook;
  for (const statement of fn.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (!ts.isIdentifier(declaration.name) || !call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== hook) continue;
      const [first] = call.arguments;
      return { name: declaration.name.text, namespace: first && ts.isStringLiteralLike(first) ? first.text : undefined };
    }
  }
  return undefined;
}

/**
 * Gives the component its translator when it has none: `const t = useTranslations('TopBar')`, and its import.
 * Returns the code and the translator's name. A translator of another group, or a "t" that is something else, is refused.
 */
export function withTranslator(text: string, file: string, component: string, i18n: I18nConfig): { text: string; name: string } {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const existing = translatorOf(sourceFile, component, i18n);
  const preset = I18N_PRESETS[i18n.library];
  if (existing) {
    if (existing.namespace !== component) {
      throw i18nError(
        'translator-namespace',
        `${component}'s translator is ${preset.hook}(${existing.namespace === undefined ? '' : `'${existing.namespace}'`}), not ${preset.hook}('${component}').`,
        `A component shows the messages of its own group: change it to ${preset.hook}('${component}'), and its keys in the message files to "${component}.…".`,
        file,
      );
    }
    return { text, name: existing.name };
  }
  if (new RegExp(`\\b(const|let|var|function)\\s+${TRANSLATOR_NAME}\\b|[({,]\\s*${TRANSLATOR_NAME}\\s*[,})=]`).test(componentFunction(sourceFile, component)?.getText(sourceFile) ?? '')) {
    throw i18nError('translator-name-taken', `"${TRANSLATOR_NAME}" is already a name in ${component}.`, `Rename it, so the translator can be "${TRANSLATOR_NAME}".`, file);
  }
  let updated = addBodyStatements(text, file, component, [`const ${TRANSLATOR_NAME} = ${preset.hook}('${component}');`]);
  updated = addNamedImport(updated, file, preset.hook, preset.from);
  return { text: updated, name: TRANSLATOR_NAME };
}

/** A message as JSX children: {t('workshops')}. */
export function messageJsx(translator: string, key: string): string {
  return `{${translator}('${key}')}`;
}
