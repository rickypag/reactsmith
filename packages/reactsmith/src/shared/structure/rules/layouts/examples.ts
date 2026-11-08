import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['layout-naming', 'layout-unexpected-file', 'layout-file-missing', 'layout-entry-missing', 'layout-entry-invalid', 'layout-file-content', 'layout-outlet'] as const;

/** The parts of the rule, in page order. */
export const sections = {
  naming: 'Naming',
  files: 'Files and folders',
} as const;

const config = { appFiles: 'app' };
const layout = 'src/app/layouts/RootLayout';

export const examples: RuleExample<keyof typeof sections>[] = [
  {
    title: 'Layouts with every file they may hold',
    config,
    tree: {
      [`${layout}/RootLayout.tsx`]: "import { Outlet } from 'react-router';\nexport const RootLayout: React.FC = () => <Outlet />;",
      [`${layout}/RootLayout.module.css`]: '',
      [`${layout}/index.ts`]: "export { RootLayout } from './RootLayout';",
      [`${layout}/tests/RootLayout.test.tsx`]: '',
      [`${layout}/stories/RootLayout.stories.tsx`]: '',
      'src/features/docs/layouts/DocsLayout/DocsLayout.tsx': "import { Outlet } from 'react-router';\nexport const DocsLayout: React.FC = () => <Outlet />;",
      'src/features/docs/layouts/DocsLayout/index.ts': "export { DocsLayout } from './DocsLayout';",
    },
    issues: [],
  },
  {
    section: 'naming',
    title: 'A layout folder not in PascalCase',
    config,
    tree: { 'src/app/layouts/root-layout/root-layout.tsx': '' },
    issues: [
      {
        issue: 'error layout-naming src/app/layouts/root-layout',
        message: 'Layout folder "root-layout" is not PascalCase.',
        hint: 'Name it like the layout it holds, e.g. "RootLayout".',
      },
    ],
  },
  {
    section: 'files',
    title: 'A part of the layout in its folder',
    config,
    tree: { [`${layout}/RootLayout.tsx`]: "import { Outlet } from 'react-router';\nexport const RootLayout: React.FC = () => <Outlet />;", [`${layout}/index.ts`]: "export { RootLayout } from './RootLayout';", [`${layout}/Header.tsx`]: '' },
    issues: [
      {
        issue: `error layout-unexpected-file ${layout}/Header.tsx`,
        message: 'File "Header.tsx" is not allowed in layout "RootLayout".',
        hint: 'A layout folder holds RootLayout.tsx, its style file and index.ts. Put the parts of the layout in the app components.',
      },
    ],
  },
  {
    section: 'files',
    title: 'A folder in a feature layout',
    config,
    tree: {
      'src/features/docs/layouts/DocsLayout/DocsLayout.tsx': "import { Outlet } from 'react-router';\nexport const DocsLayout: React.FC = () => <Outlet />;",
      'src/features/docs/layouts/DocsLayout/index.ts': "export { DocsLayout } from './DocsLayout';",
      'src/features/docs/layouts/DocsLayout/parts/Toc.tsx': '',
    },
    issues: [
      {
        issue: 'error layout-unexpected-file src/features/docs/layouts/DocsLayout/parts',
        message: 'Folder "parts" is not allowed in layout "DocsLayout".',
        hint: 'A layout folder only has the folders tests/, stories/. Put the parts of the layout in the components of feature "docs".',
      },
    ],
  },
  {
    section: 'files',
    title: 'A layout folder without its layout file',
    config,
    tree: { [`${layout}/index.ts`]: "export { RootLayout } from './RootLayout';" },
    issues: [
      {
        issue: `error layout-file-missing ${layout}`,
        message: 'Layout folder "RootLayout" has no RootLayout.tsx.',
        hint: 'The layout file is named like its folder.',
      },
    ],
  },
  {
    section: 'files',
    title: 'A layout folder without its entry point',
    config,
    tree: { [`${layout}/RootLayout.tsx`]: "import { Outlet } from 'react-router';\nexport const RootLayout: React.FC = () => <Outlet />;" },
    issues: [
      {
        issue: `error layout-entry-missing ${layout}`,
        message: 'Layout folder "RootLayout" has no index.ts.',
        hint: `Add index.ts with "export { RootLayout } from './RootLayout';".`,
      },
    ],
  },
  {
    section: 'files',
    title: 'An entry point with code besides the re-export',
    config,
    tree: {
      [`${layout}/RootLayout.tsx`]: "import { Outlet } from 'react-router';\nexport const RootLayout: React.FC = () => <Outlet />;",
      [`${layout}/index.ts`]: "export { RootLayout } from './RootLayout';\nexport const SIDEBAR_WIDTH = 240;",
    },
    issues: [
      {
        issue: `error layout-entry-invalid ${layout}/index.ts`,
        message: `Only re-exports ("export { RootLayout } from './RootLayout'") belong here, found constant "SIDEBAR_WIDTH" (line 2).`,
        hint: `It should only contain "export { RootLayout } from './RootLayout';".`,
      },
    ],
  },
  {
    section: 'files',
    title: 'A part of the layout written in the layout file',
    config,
    tree: {
      [`${layout}/RootLayout.tsx`]: "import { Outlet } from 'react-router';\nexport const RootLayout: React.FC = () => <Outlet />;\nconst Header: React.FC = () => <header />;\n",
      [`${layout}/index.ts`]: "export { RootLayout } from './RootLayout';",
    },
    issues: [`error layout-file-content ${layout}/RootLayout.tsx`],
  },
  {
    section: 'files',
    title: 'A layout without a place for the pages',
    config,
    tree: {
      [`${layout}/RootLayout.tsx`]: 'export const RootLayout: React.FC = () => <div />;\n',
      [`${layout}/index.ts`]: "export { RootLayout } from './RootLayout';",
    },
    issues: [
      {
        issue: `error layout-outlet ${layout}/RootLayout.tsx`,
        message: 'Layout "RootLayout" renders <Outlet /> 0 times, but the pages need exactly one place.',
        hint: 'Render <Outlet /> (from "react-router") once, where the pages should appear.',
      },
    ],
  },
];
