import { describe, expect, it } from 'vitest';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject } from '../helpers.js';

const lines = (...text: string[]) => `${text.join('\n')}\n`;

/** The code-folder issues of a project, as "code: path". */
async function issuesOf(tree: Record<string, string>) {
  const root = await createProject({ 'src/features/docs/index.ts': '', ...tree }, { appFiles: 'app', alias: '@' });
  const codes = /deep-import|barrel|types-runtime|hook-name|utils-uses-hook|code-folder/;
  return (await checkStructure(root)).issues.filter((issue) => codes.test(issue.code)).map((issue) => `${issue.code}: ${issue.path}`);
}

const UTILS = {
  'src/utils/date.ts': lines('export function formatDate(date: Date): string {', '  return pad(date.getDate());', '}', 'export function parseDate(text: string): Date {', '  return new Date(text);', '}', 'function pad(n: number): string {', "  return String(n).padStart(2, '0');", '}'),
  'src/utils/index.ts': "export { formatDate, parseDate } from './date';\n",
};

describe('check: hooks, utils, types and stores are imported through their barrel', () => {
  it('accepts the barrel, from outside, and files of the folder importing each other', async () => {
    expect(await issuesOf({ ...UTILS, 'src/utils/strings.ts': "import { formatDate } from './date';\nexport const today = (): string => formatDate(new Date());\n", 'src/app/App.tsx': "import { formatDate } from '@/utils';\nexport default formatDate;\n" })).toEqual([]);
  });

  it('refuses the files inside, from outside the folder, shared or of a feature', async () => {
    expect(await issuesOf({ ...UTILS, 'src/app/App.tsx': "import { formatDate } from '@/utils/date';\nexport default formatDate;\n" })).toEqual(['utils-deep-import: src/app/App.tsx']);
    const feature = {
      'src/features/docs/hooks/useDocs.ts': 'export function useDocs() {\n  return [];\n}\n',
      'src/features/docs/hooks/index.ts': "export { useDocs } from './useDocs';\n",
      'src/features/docs/routes.tsx': "import { useDocs } from './hooks/useDocs';\nexport const docsRoutes = [useDocs];\n",
    };
    expect(await issuesOf(feature)).toEqual(['hooks-deep-import: src/features/docs/routes.tsx']);
  });
});

describe('check: what each folder holds', () => {
  it('accepts plain functions, hooks named useX, types only, and re-exporting barrels', async () => {
    const tree = {
      ...UTILS,
      'src/hooks/useToggle.ts': "import { useState } from 'react';\nexport function useToggle() {\n  return useState(false);\n}\nexport const useOpen = () => useToggle();\n",
      'src/hooks/index.ts': "export { useToggle, useOpen } from './useToggle';\n",
      'src/types/page.ts': "import type { ReactNode } from 'react';\nexport interface Page { title: string; body: ReactNode }\nexport type Pages = Page[];\n",
      'src/types/index.ts': "export type { Page, Pages } from './page';\n",
      'src/stores/session.ts': 'export const session = { user: null };\n',
      'src/utils/date.test.tsx': 'export const x = <div />;\n',
    };
    expect(await issuesOf(tree)).toEqual([]);
  });

  it('reports JSX files, barrels with code, misnamed hooks, hooks in utils and values in types', async () => {
    const tree = {
      'src/utils/render.tsx': 'export const Bold = () => <b />;\n',
      'src/utils/state.ts': "import { useState } from 'react';\nexport function counter() {\n  return useState(0);\n}\n",
      'src/utils/index.ts': "export { counter } from './state';\nexport const VERSION = 1;\n",
      'src/hooks/toggle.ts': 'export function toggle() {}\n',
      'src/types/page.ts': 'export interface Page { title: string }\nexport const EMPTY: Page = { title: "" };\n',
    };
    expect((await issuesOf(tree)).sort()).toEqual(
      [
        'barrel-content: src/utils/index.ts',
        'code-folder-file-type: src/utils/render.tsx',
        'hook-name: src/hooks/toggle.ts',
        'types-runtime-code: src/types/page.ts',
        'utils-uses-hook: src/utils/state.ts',
      ].sort(),
    );
  });
});
