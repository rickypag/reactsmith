import { readFile } from 'node:fs/promises';

/** The templates folder of the package. This file sits at the same depth in src/ and dist/. */
const TEMPLATES_DIR = new URL('../../../templates/', import.meta.url);

/**
 * Reads a built-in template, e.g. "feature/index.ts", and fills its {{placeholders}}.
 * A placeholder without a value is a programming error, so it throws.
 */
export async function renderTemplate(name: string, values: Record<string, string>): Promise<string> {
  const text = await readFile(new URL(`${name}.tpl`, TEMPLATES_DIR), 'utf8');
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`Template "${name}" uses {{${key}}}, but no value was given.`);
    return value;
  });
}
