import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['code-folder-file-type', 'barrel-content', 'hook-name', 'types-runtime-code', 'utils-uses-hook'] as const;

const config = { appFiles: 'app' };

export const examples: RuleExample[] = [
  {
    title: 'Hooks, utils and types, each holding what it is for',
    config,
    tree: {
      'src/hooks/useTheme.ts': 'export const useTheme = () => null;\n',
      'src/hooks/index.ts': "export { useTheme } from './useTheme';\n",
      'src/utils/date.ts': 'export const formatDate = (date: Date) => date.toISOString();\n',
      'src/types/user.ts': 'export interface User {\n  name: string;\n}\n',
      'src/features/docs/utils/slug.ts': 'export const slug = (text: string) => text.toLowerCase();\n',
    },
    issues: [],
  },
  {
    title: 'A .tsx file in a code folder',
    config,
    tree: { 'src/hooks/useTheme.tsx': '' },
    issues: [
      {
        issue: 'error code-folder-file-type src/hooks/useTheme.tsx',
        message: 'useTheme.tsx is not a .ts file: hooks/ holds plain TypeScript, no JSX.',
        hint: 'JSX belongs to components, views and layouts: move it there, or rename the file to .ts.',
      },
    ],
  },
  {
    title: 'Code in a barrel',
    config,
    tree: { 'src/utils/index.ts': 'export const ONE = 1;\n' },
    issues: ['error barrel-content src/utils/index.ts'],
  },
  {
    title: 'Something in hooks/ not named like a hook',
    config,
    tree: { 'src/hooks/theme.ts': 'export const getTheme = () => null;\n' },
    issues: ['error hook-name src/hooks/theme.ts'],
  },
  {
    title: 'A value in types/',
    config,
    tree: { 'src/types/user.ts': 'export const DEFAULT_NAME = "Ada";\n' },
    issues: ['error types-runtime-code src/types/user.ts'],
  },
  {
    title: 'A hook used in utils/',
    config,
    tree: { 'src/utils/theme.ts': "import { useState } from 'react';\nexport const theme = () => useState();\n" },
    issues: ['error utils-uses-hook src/utils/theme.ts'],
  },
];
