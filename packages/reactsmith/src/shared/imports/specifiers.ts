import path from 'node:path';
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

export function isRelativeSpecifier(specifier: string): boolean {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

export interface SpecifierPath {
  /** Absolute path the specifier points to, without extension resolution: "src/features/auth" for "@/features/auth". */
  base: string;
  style: 'relative' | 'alias';
  /** Query or hash suffix such as "?raw". */
  suffix: string;
}

/**
 * Where a relative or alias specifier points to. Undefined for packages ("react")
 * and for other aliases. `srcDir` is the absolute folder the alias points to.
 */
export function specifierPath(value: string, importer: string, srcDir: string, alias?: string): SpecifierPath | undefined {
  const suffixAt = value.search(/[?#]/);
  const bare = suffixAt === -1 ? value : value.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? '' : value.slice(suffixAt);

  if (isRelativeSpecifier(bare)) return { base: path.resolve(path.dirname(importer), bare), style: 'relative', suffix };
  if (alias && bare.startsWith(`${alias}/`)) {
    return { base: path.resolve(srcDir, bare.slice(alias.length + 1)), style: 'alias', suffix };
  }
  return undefined;
}
