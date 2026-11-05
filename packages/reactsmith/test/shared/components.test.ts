import { describe, expect, it } from 'vitest';
import { componentEntryProblems } from '../../src/shared/structure/component-file.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject } from '../helpers.js';

describe('componentEntryProblems', () => {
  it('accepts the component and its props type', () => {
    const text = "export { Sidebar } from './Sidebar';\nexport type { SidebarProps } from './Sidebar';";
    expect(componentEntryProblems(text, 'index.ts', 'Sidebar')).toEqual([]);
  });

  it('reports other exports and code', () => {
    const text = "export { Sidebar, SidebarContent } from './Sidebar';\nexport const x = 1;";
    expect(componentEntryProblems(text, 'index.ts', 'Sidebar')).toEqual([
      'Only "Sidebar" and its "SidebarProps" type may be exported, found "SidebarContent" (line 1).',
      'Only re-exports ("export { Sidebar } from \'./Sidebar\'") belong here, found constant "x" (line 2).',
    ]);
  });

  it('reports a missing component export', () => {
    expect(componentEntryProblems("export type { SidebarProps } from './Sidebar';", 'index.ts', 'Sidebar')[0]).toBe(
      'The component "Sidebar" is not exported.',
    );
  });
});

describe('check: feature components', () => {
  const dir = 'src/features/docs/components';
  const BASE = { 'src/features/docs/index.ts': '', 'src/main.tsx': "import '@/features/docs'" };

  const component = (name: string) => `export const ${name}: React.FC = () => null;`;
  const SIDEBAR = {
    [`${dir}/Sidebar/Sidebar.tsx`]: component('Sidebar'),
    [`${dir}/Sidebar/index.ts`]: "export { Sidebar } from './Sidebar';",
  };
  const LOADING = {
    ...SIDEBAR,
    [`${dir}/Sidebar/api/queries.ts`]: '',
    [`${dir}/Sidebar/SidebarContent.tsx`]: component('SidebarContent'),
    [`${dir}/Sidebar/SidebarSkeleton.tsx`]: component('SidebarSkeleton'),
  };

  async function check(tree: Record<string, string>) {
    const root = await createProject({ ...BASE, ...tree }, { appFiles: 'root' });
    return (await checkStructure(root)).issues.filter((issue) => issue.code !== 'component-unused').map((issue) => `${issue.code} ${issue.path}`);
  }

  it('accepts a simple component, and one that loads data with all its files', async () => {
    expect(await check(SIDEBAR)).toEqual([]);
    expect(
      await check({
        ...LOADING,
        [`${dir}/Sidebar/api/mutations.ts`]: '',
        [`${dir}/Sidebar/types.ts`]: '',
        [`${dir}/Sidebar/utils.ts`]: '',
        [`${dir}/Sidebar/Sidebar.test.tsx`]: '',
        [`${dir}/Sidebar/SidebarContent.stories.tsx`]: '',
        [`${dir}/Sidebar/Sidebar.module.css`]: '',
      }),
    ).toEqual([]);
  });

  it('reports non-PascalCase folders and unexpected files', async () => {
    expect(
      await check({
        ...SIDEBAR,
        [`${dir}/user-card/`]: '',
        [`${dir}/Sidebar/SidebarHeader.tsx`]: '',
        [`${dir}/Sidebar/hooks/`]: '',
      }),
    ).toEqual([
      `component-unexpected-file ${dir}/Sidebar/hooks`,
      `component-unexpected-file ${dir}/Sidebar/SidebarHeader.tsx`,
      `component-naming ${dir}/user-card`,
    ]);
  });

  it('allows one style file per component file, in the configured format', async () => {
    expect(
      await check({
        ...SIDEBAR,
        [`${dir}/Sidebar/Sidebar.module.css`]: '',
        [`${dir}/Sidebar/SidebarContent.module.css`]: '',
        [`${dir}/Sidebar/Sidebar.css`]: '',
        [`${dir}/Sidebar/Sidebar.styles.ts`]: '',
      }),
    ).toEqual([
      `component-unexpected-file ${dir}/Sidebar/Sidebar.css`,
      `component-unexpected-file ${dir}/Sidebar/Sidebar.styles.ts`,
      `component-unexpected-file ${dir}/Sidebar/SidebarContent.module.css`,
    ]);

    const root = await createProject({ ...BASE, ...SIDEBAR, [`${dir}/Sidebar/Sidebar.styles.ts`]: '', [`${dir}/Sidebar/Sidebar.module.css`]: '' }, { appFiles: 'root', styles: 'tailwind' });
    const issues = (await checkStructure(root)).issues.filter((issue) => issue.code !== 'component-unused');
    expect(issues.map((issue) => `${issue.code} ${issue.path}`)).toEqual([`component-unexpected-file ${dir}/Sidebar/Sidebar.module.css`]);
    expect(issues[0]?.hint).toBe('Styles are tailwind ("styles" in reactsmith.config.json): each component file has its own, e.g. Sidebar.styles.ts for Sidebar.tsx.');
  });

  it('reports missing files and invalid content', async () => {
    expect(
      await check({
        [`${dir}/Sidebar/Sidebar.tsx`]: 'export function Sidebar() { return null; }',
        [`${dir}/Card/index.ts`]: "export { Card, helper } from './Card';",
      }),
    ).toEqual([
      `component-file-missing ${dir}/Card`,
      `component-entry-invalid ${dir}/Card/index.ts`,
      `component-file-content ${dir}/Sidebar/Sidebar.tsx`,
      `component-entry-missing ${dir}/Sidebar`,
    ]);
  });

  it('requires Content and Skeleton when loading data, and only Content when only editing', async () => {
    expect(await check({ ...SIDEBAR, [`${dir}/Sidebar/api/queries.ts`]: '' })).toEqual([
      `component-split-missing ${dir}/Sidebar`,
      `component-split-missing ${dir}/Sidebar`,
    ]);
    expect(await check({ ...SIDEBAR, [`${dir}/Sidebar/api/mutations.ts`]: '', [`${dir}/Sidebar/SidebarContent.tsx`]: component('SidebarContent') })).toEqual([]);
  });

  it('reports Content and Skeleton importing from api/', async () => {
    expect(
      await check({
        ...LOADING,
        [`${dir}/Sidebar/SidebarContent.tsx`]: `import { getItems } from './api/queries';\n${component('SidebarContent')}`,
        [`${dir}/Sidebar/SidebarSkeleton.tsx`]: `import { getItems } from '@/features/docs/components/Sidebar/api';\n${component('SidebarSkeleton')}`,
      }),
    ).toEqual([`component-content-imports-api ${dir}/Sidebar/SidebarContent.tsx`, `component-content-imports-api ${dir}/Sidebar/SidebarSkeleton.tsx`]);
  });
});
