import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { checkTokens as checkTokenKind } from '../../../tokens/engine.js';
import { TOKEN_KINDS } from '../../../tokens/kinds.js';

/**
 * Tokens: the colors, typography, spacing and radius of the project, each in its JSON file. Valid values and
 * references, a value for every mode, the CSS and TypeScript written from the JSON, and only known tokens used in
 * the styles. Each kind's codes start with its name: color-…, font-…, space-…, radius-….
 */
export async function checkTokens(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const read = (fileRel: string) => readFile(path.join(root, fileRel), 'utf8').catch(() => undefined);
  const issues: Issue[] = [];
  for (const kind of TOKEN_KINDS) issues.push(...(await checkTokenKind(kind, root, config, read)));
  return issues;
}
