import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['constants-file-content'] as const;

const config = { appFiles: 'app' };

export const examples: RuleExample[] = [
  {
    title: 'Constants holding plain data',
    config,
    tree: {
      'src/app/constants.ts': "export const TITLE = 'Docs';\nexport const LINKS = [{ label: 'Guide', href: '/guide' }];\n",
    },
    issues: [],
  },
  {
    title: 'A function in a constants file',
    config,
    tree: { 'src/app/constants.ts': "export const TITLE = 'Docs';\nexport function title() {\n  return TITLE;\n}\n" },
    issues: ['error constants-file-content src/app/constants.ts'],
  },
];
