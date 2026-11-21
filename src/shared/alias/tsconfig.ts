import { applyEdits, modify, parse } from 'jsonc-parser';

/** Checked in order: Vite projects keep compiler options in tsconfig.app.json. */
export const TSCONFIG_FILES = ['tsconfig.app.json', 'tsconfig.json'];

export type PathAliasResult =
  | { status: 'added'; text: string }
  | { status: 'exists' }
  | { status: 'conflict'; existing: unknown };

/**
 * Adds `"<alias>/*": ["./<srcDir>/*"]` to compilerOptions.paths.
 * Edits the text in place so comments and formatting are kept.
 */
export function addPathAlias(text: string, alias: string, srcDir: string): PathAliasResult {
  const key = `${alias}/*`;
  const value = [`./${srcDir}/*`];
  const tsconfig = parse(text, [], { allowTrailingComma: true }) as
    | { compilerOptions?: { paths?: Record<string, unknown> } }
    | undefined;

  const existing = tsconfig?.compilerOptions?.paths?.[key];
  if (existing !== undefined) {
    return JSON.stringify(existing) === JSON.stringify(value) ? { status: 'exists' } : { status: 'conflict', existing };
  }

  const edits = modify(text, ['compilerOptions', 'paths', key], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' },
  });
  return { status: 'added', text: applyEdits(text, edits) };
}
