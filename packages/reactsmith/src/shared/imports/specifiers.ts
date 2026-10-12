import ts from 'typescript';

export interface Specifier {
  /** The module specifier as written, e.g. "./App.tsx" or "@/components/Button". */
  value: string;
  /** Offset of the first character inside the quotes. */
  start: number;
  end: number;
}

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export function isCodeFile(file: string): boolean {
  return CODE_EXTENSIONS.some((ext) => file.endsWith(ext)) && !file.endsWith('.d.ts');
}

/**
 * Finds every module specifier in a source file: static imports, `export ... from`,
 * dynamic `import()` and `require()`, including type-only imports.
 */
export function findSpecifiers(text: string): Specifier[] {
  const { importedFiles } = ts.preProcessFile(text, true, true);
  const specifiers: Specifier[] = [];
  for (const { fileName, pos } of importedFiles) {
    // `pos` points at the opening quote.
    const start = pos + 1;
    const end = start + fileName.length;
    if (text.slice(start, end) !== fileName) continue;
    specifiers.push({ value: fileName, start, end });
  }
  return specifiers;
}
