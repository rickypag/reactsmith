import { TOOL_NAME } from '../../../config/defaults.js';
import type { ResolvedConfig } from '../../../config/types.js';
import { allMessages, messagesFile, type Messages } from '../../../i18n/messages.js';
import { isUsed, messageUsages } from '../../../i18n/usages.js';
import type { Issue } from '../../../issues.js';

/** At most this many keys are named in one issue; the count says the rest. */
const LISTED = 5;

const listKeys = (keys: string[]) => `${keys.slice(0, LISTED).join(', ')}${keys.length > LISTED ? ` and ${keys.length - LISTED} more` : ''}`;

/**
 * The keys: every key the code shows is in the default language (an element without text otherwise), the other
 * languages have every key of the default one (what is left to translate), and every key is shown somewhere.
 */
export async function keyIssues(root: string, config: ResolvedConfig, files: Map<string, Messages>): Promise<Issue[]> {
  const i18n = config.i18n!;
  const defaults = files.get(i18n.defaultLocale);
  if (!defaults) return [];
  const defaultRel = messagesFile(i18n, i18n.defaultLocale);
  const keys = allMessages(defaults);
  const usages = await messageUsages(root, config);
  const issues: Issue[] = [];

  for (const call of usages.calls) {
    if (keys.has(call.key)) continue;
    issues.push({
      severity: 'error',
      code: 'message-missing',
      path: call.fileRel,
      message: `"${call.key}" (line ${call.line}) is not in ${defaultRel}, so the page shows the key instead of a text.`,
      hint: `Add its text: "${TOOL_NAME} messages --set \\"${call.key}=…\\" --locale ${i18n.defaultLocale}".`,
    });
  }

  for (const [locale, messages] of files) {
    if (locale === i18n.defaultLocale) continue;
    const translated = allMessages(messages);
    const missing = [...keys.keys()].filter((key) => !translated.has(key));
    if (missing.length === 0) continue;
    const fileRel = messagesFile(i18n, locale);
    issues.push({
      severity: 'warning',
      code: 'message-untranslated',
      path: fileRel,
      message: `${fileRel} lacks ${missing.length} ${missing.length === 1 ? 'text' : 'texts'} of ${defaultRel}: ${listKeys(missing)}.`,
      hint: `Translate them: "${TOOL_NAME} messages --set \\"${missing[0]}=…\\" --locale ${locale}".`,
    });
  }

  const unused = [...keys.keys()].filter((key) => isUsed(usages, key).length === 0);
  if (unused.length) {
    issues.push({
      severity: 'warning',
      code: 'message-unused',
      path: defaultRel,
      message: `${unused.length === 1 ? 'A text is' : `${unused.length} texts are`} shown nowhere: ${listKeys(unused)}.`,
      hint: `Show ${unused.length === 1 ? 'it' : 'them'} with "element insert … --message <key>", or remove ${unused.length === 1 ? 'it' : 'them'}: "${TOOL_NAME} messages --remove \\"${unused[0]}\\"".`,
    });
  }
  return issues;
}
