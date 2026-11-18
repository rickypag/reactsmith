import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { featureCreateCommand } from '../../src/commands/feature/create/command.js';
import { runInit } from '../../src/commands/init/init.js';
import { viewCreateCommand } from '../../src/commands/view/create/command.js';
import { layoutCreateCommand } from '../../src/commands/layout/create/command.js';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read } from '../helpers.js';

/** A create-next-app project with the src/ folder. */
const NEXT_PROJECT: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { next: '^15.5.0', react: '^19.0.0' } }),
  'tsconfig.json': '{\n  "compilerOptions": {\n    "jsx": "preserve",\n    "paths": { "@/*": ["./src/*"] }\n  }\n}\n',
  'src/app/layout.tsx': "import './globals.css';\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang=\"en\">\n      <body>{children}</body>\n    </html>\n  );\n}\n",
  'src/app/globals.css': 'body { margin: 0; }\n',
};

const viewOptions = { feature: 'docs', path: undefined, index: false, loader: false, empty: false, dryRun: false };

async function setUp(): Promise<string> {
  const root = await createProject(NEXT_PROJECT);
  await runInit(root, { noSkills: true });
  await featureCreateCommand.run({ cwd: root, args: { name: 'docs' }, options: { path: undefined, noMount: false, layout: undefined, dryRun: false } });
  return root;
}

async function writePage(root: string, fileRel: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, fileRel)), { recursive: true });
  await writeFile(path.join(root, fileRel), text);
}

describe('a Next.js app', () => {
  it('creates a view exported from its feature, which a page renders, and check passes', async () => {
    const root = await setUp();
    const result = await viewCreateCommand.run({ cwd: root, args: { name: 'Settings' }, options: viewOptions });

    expect(result.ok).toBe(true);
    expect(result.actions?.map((action) => `${action.type} ${action.path}`)).toEqual([
      'create src/features/docs/views/SettingsView/SettingsView.tsx',
      'create src/features/docs/views/SettingsView/SettingsView.module.css',
      'create src/features/docs/views/SettingsView/index.ts',
      'update src/features/docs/index.ts',
    ]);
    expect(await read(root, 'src/features/docs/views/SettingsView/index.ts')).toBe("export { SettingsView } from './SettingsView';\n");
    expect(await read(root, 'src/features/docs/index.ts')).toContain("export { SettingsView } from './views/SettingsView';");
    expect(result.summary).toContain("src/app/docs/settings/page.tsx: import { SettingsView } from '@/features/docs';");

    await writePage(root, 'src/app/settings/page.tsx', "import { SettingsView } from '@/features/docs';\n\nexport default function Page() {\n  return <SettingsView />;\n}\n");
    const { issues } = await checkStructure(root);
    expect(issues).toEqual([]);
  });

  it('refuses the route options of feature create, instead of ignoring them', async () => {
    const root = await createProject(NEXT_PROJECT);
    await runInit(root, { noSkills: true });
    const run = (options: { path?: string; noMount?: boolean; layout?: string }) =>
      featureCreateCommand.run({ cwd: root, args: { name: 'docs' }, options: { path: options.path, noMount: options.noMount ?? false, layout: options.layout, dryRun: false } });
    for (const options of [{ path: 'docs' }, { layout: 'DocsLayout' }, { noMount: true }]) {
      const result = await run(options);
      expect(result.ok).toBe(false);
      expect(result.issues?.map((issue) => issue.code)).toEqual(['next-routes-pages']);
    }
    const created = await run({});
    expect(created.ok).toBe(true);
    expect(created.actions?.find((action) => action.type === 'skip')?.message).toBe('Next.js routes the pages, so no routes file');
  });

  it('refuses the route options, which are for React Router', async () => {
    const root = await setUp();
    const result = await viewCreateCommand.run({ cwd: root, args: { name: 'Settings' }, options: { ...viewOptions, path: 'settings' } });
    expect(result.ok).toBe(false);
    expect(result.issues?.map((issue) => issue.code)).toEqual(['next-routes-pages']);
  });

  it('still refuses a page that imports from inside a feature', async () => {
    const root = await setUp();
    await viewCreateCommand.run({ cwd: root, args: { name: 'Settings' }, options: viewOptions });
    await writePage(root, 'src/app/settings/page.tsx', "import { SettingsView } from '@/features/docs/views/SettingsView';\n\nexport default function Page() {\n  return <SettingsView />;\n}\n");
    const { issues } = await checkStructure(root);
    expect(issues.map((issue) => `${issue.code} ${issue.path}`)).toEqual(['feature-deep-import src/app/settings/page.tsx']);
  });

  it('creates the root layout around the children, which src/app/layout.tsx renders, and check passes', async () => {
    const root = await setUp();
    const result = await layoutCreateCommand.run({ cwd: root, args: { name: undefined }, options: { feature: undefined, topbar: true, sidebar: false, dryRun: false } });

    expect(result.ok).toBe(true);
    expect(result.actions?.map((action) => `${action.type} ${action.path}`)).toEqual([
      'create src/shell/components/TopBar/TopBar.tsx',
      'create src/shell/components/TopBar/TopBar.module.css',
      'create src/shell/components/TopBar/index.ts',
      'create src/shell/layouts/RootLayout/RootLayout.tsx',
      'create src/shell/layouts/RootLayout/RootLayout.module.css',
      'create src/shell/layouts/RootLayout/index.ts',
    ]);
    expect(await read(root, 'src/shell/layouts/RootLayout/RootLayout.tsx')).toBe(
      [
        "import { TopBar } from '../../components/TopBar';",
        "import styles from './RootLayout.module.css';",
        '',
        'interface RootLayoutProps {',
        '  children: React.ReactNode;',
        '}',
        '',
        'export const RootLayout: React.FC<RootLayoutProps> = ({ children }) => {',
        '  return (',
        '    <div className={styles.root}>',
        '      <TopBar />',
        '      <main className={styles.main}>',
        '        {children}',
        '      </main>',
        '    </div>',
        '  );',
        '};',
        '',
      ].join('\n'),
    );
    expect(result.summary).toBe(
      "Layout \"RootLayout\" created. Render it in src/app/layout.tsx: import { RootLayout } from '@/shell/layouts/RootLayout'; <body><RootLayout>{children}</RootLayout></body>",
    );

    await writePage(root, 'src/app/layout.tsx', [
      "import { RootLayout } from '@/shell/layouts/RootLayout';",
      "import '../shell/styles/global.css';",
      '',
      'export default function Layout({ children }: { children: React.ReactNode }) {',
      '  return (',
      '    <html lang="en">',
      '      <body>',
      '        <RootLayout>{children}</RootLayout>',
      '      </body>',
      '    </html>',
      '  );',
      '}',
      '',
    ].join('\n'));
    // The docs feature of setUp has no page yet.
    expect((await checkStructure(root)).issues).toEqual([
      expect.objectContaining({ code: 'feature-unused', hint: 'Use it (e.g. render one of its views from a page of src/app/) or remove it.' }),
    ]);

    const inserted = await elementInsertCommand.run({
      cwd: root,
      args: { name: 'nav' },
      options: { around: undefined, through: undefined, if: undefined, fallback: undefined, into: 'shell/layouts/RootLayout/RootLayout.tsx#main', position: 'first', from: undefined, props: undefined, text: undefined, message: undefined, name: 'crumbs', direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
    });
    expect(inserted.issues).toEqual([]);
    expect(inserted.ok).toBe(true);
    expect(await read(root, 'src/shell/layouts/RootLayout/RootLayout.tsx')).toContain('<nav className={styles.crumbs} />\n        {children}');
  });

  it("creates a feature's layout, exported from the feature for its route folder's layout.tsx", async () => {
    const root = await setUp();
    await viewCreateCommand.run({ cwd: root, args: { name: 'Settings' }, options: viewOptions });
    const result = await layoutCreateCommand.run({ cwd: root, args: { name: undefined }, options: { feature: 'docs', topbar: false, sidebar: true, dryRun: false } });

    expect(result.ok).toBe(true);
    expect(result.actions?.map((action) => `${action.type} ${action.path}`)).toEqual([
      'update src/features/docs/index.ts',
      'create src/features/docs/components/Sidebar/Sidebar.tsx',
      'create src/features/docs/components/Sidebar/Sidebar.module.css',
      'create src/features/docs/components/Sidebar/index.ts',
      'create src/features/docs/layouts/DocsLayout/DocsLayout.tsx',
      'create src/features/docs/layouts/DocsLayout/DocsLayout.module.css',
      'create src/features/docs/layouts/DocsLayout/index.ts',
    ]);
    expect(await read(root, 'src/features/docs/index.ts')).toContain("export { DocsLayout } from './layouts/DocsLayout';");
    expect(result.summary).toContain("src/app/docs/layout.tsx, the route folder of the feature's pages: import { DocsLayout } from '@/features/docs';");

    await writePage(root, 'src/app/docs/layout.tsx', "import { DocsLayout } from '@/features/docs';\n\nexport default function Layout({ children }: { children: React.ReactNode }) {\n  return <DocsLayout>{children}</DocsLayout>;\n}\n");
    await writePage(root, 'src/app/docs/settings/page.tsx', "import { SettingsView } from '@/features/docs';\n\nexport default function Page() {\n  return <SettingsView />;\n}\n");
    expect((await checkStructure(root)).issues).toEqual([]);
  });

  it('reports a layout that does not render its children', async () => {
    const root = await setUp();
    await layoutCreateCommand.run({ cwd: root, args: { name: undefined }, options: { feature: undefined, topbar: false, sidebar: false, dryRun: false } });
    const fileRel = 'src/shell/layouts/RootLayout/RootLayout.tsx';
    await writePage(root, fileRel, (await read(root, fileRel)).replace('{children}', ''));
    await writePage(root, 'src/app/layout.tsx', "import { RootLayout } from '@/shell/layouts/RootLayout';\n\nexport default function Layout({ children }: { children: React.ReactNode }) {\n  return <RootLayout>{children}</RootLayout>;\n}\n");
    const issues = (await checkStructure(root)).issues;
    expect(issues.filter((issue) => issue.code === 'layout-outlet').map((issue) => issue.message)).toEqual([
      'Layout "RootLayout" renders {children} 0 times, but the pages need exactly one place.',
    ]);
  });

  it('refuses a view imported by anything but a page or its feature', async () => {
    const root = await setUp();
    await viewCreateCommand.run({ cwd: root, args: { name: 'Settings' }, options: viewOptions });
    await writePage(root, 'src/utils/preview.ts', "export { SettingsView } from '@/features/docs';\n");
    const { issues } = await checkStructure(root);
    expect(issues.map((issue) => issue.code)).toContain('shared-imports-feature');
  });
});

describe('the page view create suggests', () => {
  const summaryOf = async (root: string, name: string, feature: string) =>
    (await viewCreateCommand.run({ cwd: root, args: { name }, options: { ...viewOptions, feature } })).summary ?? '';

  it("goes inside the locale segment, next to the feature's pages, and the main view is the feature's own page", async () => {
    const root = await setUp();
    // next-intl: the whole site is in [locale], whose layout is the root one.
    await writePage(root, 'src/app/[locale]/layout.tsx', "export default function Layout({ children }: { children: React.ReactNode }) {\n  return <html><body>{children}</body></html>;\n}\n");
    expect(await summaryOf(root, 'Settings', 'docs')).toContain('e.g. src/app/[locale]/docs/settings/page.tsx:');
    expect(await summaryOf(root, 'Docs', 'docs')).toContain('e.g. src/app/[locale]/docs/page.tsx:');

    // A feature whose pages already live elsewhere ("help"), dynamic segments of its pages left out.
    await featureCreateCommand.run({ cwd: root, args: { name: 'support' }, options: { path: undefined, noMount: false, layout: undefined, dryRun: false } });
    await writePage(root, 'src/app/[locale]/help/[topic]/page.tsx', "import { SupportView } from '@/features/support';\n\nexport default function Page() {\n  return <SupportView />;\n}\n");
    expect(await summaryOf(root, 'HelpCenter', 'support')).toContain('e.g. src/app/[locale]/help/help-center/page.tsx:');
  });
});
