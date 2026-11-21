import { describe, expect, it } from 'vitest';
import { componentCreateCommand } from '../../src/commands/component/create/command.js';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, exists, read } from '../helpers.js';

const buttons = 'src/components/buttons';

interface CreateOptions {
  feature?: string;
  app?: boolean;
  type?: string;
  interface?: string;
}

const create = (root: string, name: string, options: CreateOptions) =>
  componentCreateCommand.run({
    cwd: root,
    args: { name },
    options: { feature: options.feature, app: options.app ?? false, type: options.type, interface: options.interface, rootProps: undefined, from: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, root: undefined, text: undefined, jsx: undefined, replace: false, dryRun: false },
  });

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);

/** A component file with its entry point, for trees. */
const component = (folder: string, name: string) => ({
  [`${folder}/${name}/${name}.tsx`]: `export const ${name}: React.FC = () => <div />;\n`,
  [`${folder}/${name}/index.ts`]: `export { ${name} } from './${name}';\n`,
});

describe('component create --type', () => {
  it('creates a shared component in the folder of its type, offered by the type barrel', async () => {
    const root = await createProject({}, { appFiles: 'app' });
    const result = await create(root, 'PrimaryButton', { type: 'buttons', interface: 'label: string' });
    expect(result.issues).toEqual([]);
    expect(await exists(root, `${buttons}/PrimaryButton/PrimaryButton.tsx`)).toBe(true);
    expect(await read(root, `${buttons}/index.ts`)).toBe("export { PrimaryButton } from './PrimaryButton';\nexport type { PrimaryButtonProps } from './PrimaryButton';\n");

    await create(root, 'IconButton', { type: 'buttons' });
    expect(await read(root, `${buttons}/index.ts`)).toContain("export type { PrimaryButtonProps } from './PrimaryButton';\nexport { IconButton } from './IconButton';\n");
    expect((await checkStructure(root)).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('refuses unknown types, more than one owner, and names used anywhere in the project', async () => {
    const root = await createProject(component('src/features/docs/components', 'UserCard'), { appFiles: 'app' });
    expect(codes(await create(root, 'Chart', { type: 'charts' }))).toEqual(['unknown-component-type']);
    expect(codes(await create(root, 'Chart', { type: 'cards', app: true }))).toEqual(['options-conflict']);
    expect(codes(await create(root, 'UserCard', { type: 'cards' }))).toEqual(['component-name-taken']);
    expect((await create(root, 'Chart', { type: 'charts' })).issues?.[0]?.hint).toContain('"componentTypes"');
  });

  it('warns, without refusing, when a dependency exports the same name; the icon library is left out', async () => {
    const pkg = (name: string, exported: string[]) => ({
      [`node_modules/${name}/package.json`]: JSON.stringify({ name, types: 'index.d.ts' }),
      [`node_modules/${name}/index.d.ts`]: exported.map((item) => `export declare const ${item}: () => null;`).join('\n'),
    });
    const root = await createProject(
      { ...pkg('react-router', ['Link']), ...pkg('lucide-react', ['Search']), 'package.json': JSON.stringify({ dependencies: { 'react-router': '7', 'lucide-react': '1' } }) },
      { appFiles: 'app', icons: { library: 'lucide-react' } },
    );
    const link = await create(root, 'Link', { type: 'links' });
    expect(link.ok).toBe(true);
    expect(link.issues?.map((issue) => `${issue.severity} ${issue.code}: ${issue.message}`)).toEqual(['warning component-name-in-dependency: "Link" is also exported by react-router.']);
    expect((await create(root, 'Search', { type: 'fields' })).issues).toEqual([]);
  });

  it('accepts a custom list of types', async () => {
    const root = await createProject({}, { appFiles: 'app', componentTypes: { data: ['charts'] } });
    expect((await create(root, 'BarChart', { type: 'charts' })).issues).toEqual([]);
    expect(codes(await create(root, 'PrimaryButton', { type: 'buttons' }))).toEqual(['unknown-component-type']);
  });

  it('is found by element insert, and imported through the type barrel', async () => {
    const view = 'src/features/docs/views/HomeView/HomeView.tsx';
    const root = await createProject(
      { ...component(buttons, 'PrimaryButton'), [`${buttons}/index.ts`]: "export { PrimaryButton } from './PrimaryButton';\n", [view]: 'export const HomeView: React.FC = () => {\n  return <main />;\n};\n', 'src/features/docs/index.ts': '' },
      { appFiles: 'app' },
    );
    const result = await elementInsertCommand.run({
      cwd: root,
      args: { name: 'PrimaryButton' },
      options: { around: undefined, through: undefined, if: undefined, fallback: undefined, into: 'features/docs/views/HomeView/HomeView.tsx#main', position: undefined, from: undefined, props: undefined, text: undefined, message: undefined, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
    });
    expect(result.issues).toEqual([]);
    expect(await read(root, view)).toContain("import { PrimaryButton } from '@/components/buttons';");
  });
});

describe('check: shared components', () => {
  async function issuesOf(tree: Record<string, string>) {
    const root = await createProject({ 'src/features/docs/index.ts': '', ...tree }, { appFiles: 'app' });
    const relevant = /component-type|shared-component|deep-import|component-name|view-import|barrel/;
    return (await checkStructure(root)).issues.filter((issue) => relevant.test(issue.code)).map((issue) => `${issue.code}: ${issue.path}`);
  }
  const BUTTONS = { ...component(buttons, 'PrimaryButton'), ...component(buttons, 'IconButton'), [`${buttons}/index.ts`]: "export { PrimaryButton } from './PrimaryButton';\nexport { IconButton } from './IconButton';\n" };

  it('requires every shared component to be in a configured type', async () => {
    expect(await issuesOf({ ...component('src/components', 'Loose'), ...component('src/components/widgets', 'Widget') })).toEqual([
      'unknown-component-type: src/components/Loose',
      'unknown-component-type: src/components/widgets',
    ]);
  });

  it('imports shared components through the type barrel, except between components of the same type', async () => {
    const user = (from: string) => ({ 'src/app/components/Shell/Shell.tsx': `import { PrimaryButton } from '${from}';\nexport const Shell: React.FC = () => <PrimaryButton />;\n`, 'src/app/components/Shell/index.ts': "export { Shell } from './Shell';\n" });
    expect(await issuesOf({ ...BUTTONS, ...user('@/components/buttons') })).toEqual([]);
    expect(await issuesOf({ ...BUTTONS, ...user('@/components/buttons/PrimaryButton') })).toEqual(['shared-component-import: src/app/components/Shell/Shell.tsx']);
    expect(await issuesOf({ ...BUTTONS, ...user('@/components/buttons/PrimaryButton/PrimaryButton') })).toEqual(['component-deep-import: src/app/components/Shell/Shell.tsx']);
    const sibling = { [`${buttons}/IconButton/IconButton.tsx`]: "import { PrimaryButton } from '../PrimaryButton';\nexport const IconButton: React.FC = () => <PrimaryButton />;\n" };
    expect(await issuesOf({ ...BUTTONS, ...sibling })).toEqual([]);
  });

  it('keeps the type barrel to re-exports', async () => {
    expect(await issuesOf({ ...BUTTONS, [`${buttons}/index.ts`]: "export { PrimaryButton } from './PrimaryButton';\nexport const SIZE = 2;\n" })).toEqual([`component-type-barrel-content: ${buttons}/index.ts`]);
  });
});

describe('check: names and views', () => {
  async function issuesOf(tree: Record<string, string>) {
    const root = await createProject({ 'src/features/docs/index.ts': '', ...tree }, { appFiles: 'app' });
    return (await checkStructure(root)).issues.filter((issue) => /component-name|view-import/.test(issue.code)).map((issue) => `${issue.code}: ${issue.message}`);
  }

  it('reports two importable components with the same name, but not two views', async () => {
    const tree = {
      ...component('src/features/docs/components', 'Header'),
      ...component('src/app/components', 'Header'),
      ...component('src/features/docs/views', 'OverviewView'),
      'src/features/blog/index.ts': '',
      ...component('src/features/blog/views', 'OverviewView'),
    };
    expect(await issuesOf(tree)).toEqual(['component-name-taken: "Header" is the name of 2 components: src/features/docs/components/Header, src/app/components/Header.']);
  });

  it('loads views only from routes', async () => {
    const tree = {
      ...component('src/features/docs/views', 'HomeView'),
      'src/features/docs/routes.tsx': "export const docsRoutes = [{ index: true, lazy: () => import('./views/HomeView') }];\n",
      'src/features/docs/components/Panel/Panel.tsx': "import { HomeView } from '../../views/HomeView';\nexport const Panel: React.FC = () => <HomeView />;\n",
      'src/features/docs/components/Panel/index.ts': "export { Panel } from './Panel';\n",
    };
    expect(await issuesOf(tree)).toEqual(['view-import-outside-routes: "../../views/HomeView" imports the view "HomeView": views are only loaded by routes.']);
  });
});
