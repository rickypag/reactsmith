import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['next-app-file', 'next-private-folder'] as const;

const next = { framework: 'next' };

export const examples: RuleExample[] = [
  {
    title: "Next's app folder with pages, layouts, routes, metadata and CSS",
    config: next,
    tree: {
      'src/app/layout.tsx': '',
      'src/app/page.tsx': '',
      'src/app/globals.css': '',
      'src/app/favicon.ico': '',
      'src/app/not-found.tsx': '',
      'src/app/docs/[slug]/page.tsx': '',
      'src/app/docs/[slug]/opengraph-image.png': '',
      'src/app/(marketing)/pricing/page.tsx': '',
      'src/app/api/search/route.ts': '',
      'src/shell/layouts/RootLayout/RootLayout.tsx': '',
    },
    issues: [],
  },
  {
    title: 'A component in a route folder',
    config: next,
    tree: { 'src/app/docs/page.tsx': '', 'src/app/docs/DocCard.tsx': '' },
    issues: [
      {
        issue: 'error next-app-file src/app/docs/DocCard.tsx',
        message: '"DocCard.tsx" is not a file of Next.js: src/app/docs/ holds only pages, layouts, routes, metadata files and CSS.',
        hint: 'Move it out of the app folder: components and views in a feature (src/features/<feature>/) or in src/components/, other code in src/utils/ or src/lib/.',
      },
    ],
  },
  {
    title: 'Components kept in a private folder next to the page',
    config: next,
    tree: { 'src/app/docs/page.tsx': '', 'src/app/docs/_components/DocCard.tsx': '' },
    issues: [
      {
        issue: 'error next-private-folder src/app/docs/_components',
        message: '"_components" is a private folder in src/app/docs/: Next\'s app folder holds only the pages, not their components.',
        hint: 'Move what it holds out of the app folder: components and views in a feature (src/features/<feature>/) or in src/components/, other code in src/utils/ or src/lib/. The page then imports its view.',
      },
    ],
  },
];
