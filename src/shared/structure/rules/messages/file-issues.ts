import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { TOOL_NAME } from '../../../config/defaults.js';
import type { I18nConfig } from '../../../config/types.js';
import { listLocales, messagesFile, readMessages, type Messages } from '../../../i18n/messages.js';
import { IssueError, type Issue } from '../../../issues.js';

/**
 * The message files, read: each language's, by language. The default language must have its file; a file that is not
 * valid messages is reported and left out.
 */
export async function fileIssues(root: string, i18n: I18nConfig): Promise<{ issues: Issue[]; files: Map<string, Messages> }> {
  const issues: Issue[] = [];
  const files = new Map<string, Messages>();
  const read = (fileRel: string) => readFile(path.join(root, fileRel), 'utf8').catch(() => undefined);
  for (const locale of await listLocales(root, i18n)) {
    const fileRel = messagesFile(i18n, locale);
    try {
      const messages = await readMessages(read, fileRel);
      if (messages) files.set(locale, messages);
      else {
        issues.push({
          severity: 'error',
          code: 'messages-default-missing',
          path: fileRel,
          message: `${fileRel}, the messages of the default language "${locale}", doesn't exist.`,
          hint: `Create it with the first texts: "${TOOL_NAME} messages --set \\"Group.key=Text\\" --locale ${locale}".`,
        });
      }
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      issues.push(...error.issues);
    }
  }
  return { issues, files };
}
