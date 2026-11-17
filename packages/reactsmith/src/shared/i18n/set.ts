import type { ChangeSet } from '../changes.js';
import { LOCALE } from '../config/validate.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';
import { allMessages, keyPath, listLocales, messagesFile, readMessages, requireI18n, serializeMessages, type Messages } from './messages.js';
import { isUsed, messageUsages } from './usages.js';

export interface MessagesOptions {
  /** "TopBar.workshops=Workshops; TopBar.register=Register": keys and their texts, separated by ";" ("\;" is a literal one). */
  set?: string;
  /** The language the --set texts are in. */
  locale?: string;
  /** Keys or groups to remove from every language, separated by ";". */
  remove?: string;
}

function messagesError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** Splits on the ";" that are not written "\;", which stay as ";" in the text. */
function splitAssignments(text: string): string[] {
  return text.split(/(?<!\\);/).map((part) => part.replace(/\\;/g, ';').trim()).filter(Boolean);
}

/** "TopBar.workshops=Workshops" → [["TopBar", "workshops"], "Workshops"]: the text is everything after the first "=". */
function parseAssignment(part: string): [string[], string] {
  const equals = part.indexOf('=');
  if (equals <= 0) throw messagesError('messages-set-invalid', `"${part}" is not "key=text".`, 'E.g. --set "TopBar.workshops=Workshops; TopBar.register=Register".');
  const keys = keyPath(part.slice(0, equals));
  const text = part.slice(equals + 1).trim();
  if (!text) throw messagesError('messages-set-invalid', `"${keys.join('.')}" has no text.`, 'Give it one, or remove the key with --remove.');
  if (keys.length < 2) throw messagesError('message-key-invalid', `"${keys.join('.')}" has no group.`, 'Keys start with the component that shows them, e.g. "TopBar.workshops".');
  return [keys, text];
}

/** Sets a text in a file, creating its groups; a key that is a group, or a group that is a text, is refused. */
function setMessage(messages: Messages, keys: string[], text: string, fileRel: string): boolean {
  let group = messages;
  for (const [index, key] of keys.slice(0, -1).entries()) {
    const inner = group[key];
    if (typeof inner === 'string') throw messagesError('message-key-taken', `"${keys.slice(0, index + 1).join('.')}" is a text in ${fileRel}, not a group.`, 'Use another key, or remove that text first.', fileRel);
    group = (group[key] ??= {}) as Messages;
  }
  const last = keys[keys.length - 1]!;
  if (typeof group[last] === 'object') throw messagesError('message-key-taken', `"${keys.join('.')}" is a group in ${fileRel}, not a text.`, 'Set the texts inside it, e.g. "' + `${keys.join('.')}.title=…"`, fileRel);
  if (group[last] === text) return false;
  group[last] = text;
  return true;
}

/** Removes a key or a group, and the groups it leaves empty. Returns whether it was there. */
function removeMessage(messages: Messages, keys: string[]): boolean {
  const [first, ...rest] = keys as [string, ...string[]];
  if (!(first in messages)) return false;
  if (rest.length === 0) {
    delete messages[first];
    return true;
  }
  const inner = messages[first];
  if (typeof inner !== 'object') return false;
  const removed = removeMessage(inner, rest);
  if (removed && Object.keys(inner).length === 0) delete messages[first];
  return removed;
}

/**
 * Plans the message files: --set writes texts in one language (its file is created when it is a new language),
 * --remove takes keys out of every language, refused while code shows them. Returns what changed, for the summary.
 */
export async function planMessages(changes: ChangeSet, config: ResolvedConfig, options: MessagesOptions): Promise<string[]> {
  const i18n = requireI18n(config);
  if (options.set === undefined && options.remove === undefined) throw messagesError('messages-nothing', 'Nothing to change.', 'Pass --set "Group.key=Text" --locale <language>, or --remove "Group.key".');
  if (options.set !== undefined && options.locale === undefined) throw messagesError('options-conflict', '--set needs --locale: the language of the texts.', `E.g. --locale ${i18n.defaultLocale}.`);
  if (options.locale !== undefined && options.set === undefined) throw messagesError('options-conflict', '--locale applies to the --set texts.', 'Pass the texts with --set.');
  if (options.locale !== undefined && !LOCALE.test(options.locale)) throw messagesError('locale-invalid', `"${options.locale}" is not a language code.`, 'E.g. "en", "it" or "pt-BR".');

  const read = (fileRel: string) => changes.read(fileRel);
  const done: string[] = [];
  const sets = options.set === undefined ? [] : splitAssignments(options.set).map(parseAssignment);
  if (options.set !== undefined && sets.length === 0) throw messagesError('messages-set-invalid', '--set has no "key=text".', 'E.g. --set "TopBar.workshops=Workshops".');
  const files = new Map<string, Messages>();
  const load = async (locale: string) => {
    const fileRel = messagesFile(i18n, locale);
    if (!files.has(fileRel)) files.set(fileRel, (await readMessages(read, fileRel)) ?? {});
    return { fileRel, messages: files.get(fileRel)! };
  };

  if (options.locale !== undefined) {
    const { fileRel, messages } = await load(options.locale);
    for (const [keys, text] of sets) if (setMessage(messages, keys, text, fileRel)) done.push(keys.join('.'));
  }

  if (options.remove !== undefined) {
    const removes = splitAssignments(options.remove).map(keyPath);
    const usages = await messageUsages(changes.root, config);
    for (const keys of removes) {
      const key = keys.join('.');
      // A group is in use when any of its keys is.
      const defaults = allMessages((await load(i18n.defaultLocale)).messages);
      const inside = [...defaults.keys()].filter((candidate) => candidate === key || candidate.startsWith(`${key}.`));
      const users = [...new Set([key, ...inside].flatMap((candidate) => isUsed(usages, candidate)))];
      if (users.length) throw messagesError('message-in-use', `"${key}" is still shown in ${users.join(', ')}.`, 'Remove those elements or give them another message first ("element update <id> --message …").');
      let found = false;
      for (const locale of await listLocales(changes.root, i18n)) found = removeMessage((await load(locale)).messages, keys) || found;
      if (!found) throw messagesError('message-not-found', `"${key}" is in no message file.`, 'Check the key: a group and its key, e.g. "TopBar.workshops".');
      done.push(`removed ${key}`);
    }
  }

  for (const [fileRel, messages] of files) {
    const text = serializeMessages(messages);
    const current = await read(fileRel);
    if (current === undefined) changes.write(fileRel, text, { type: 'create', message: 'messages of a new language' });
    else if (current !== text) changes.write(fileRel, text, { type: 'update', message: 'messages' });
  }
  return done;
}
