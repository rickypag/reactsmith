import { describe, expect, it } from 'vitest';
import { checkStructure } from '../../src/shared/structure/check.js';
import { componentFileProblems, viewEntryProblems } from '../../src/shared/structure/component-file.js';
import { createProject } from '../helpers.js';

describe('componentFileProblems', () => {
  it('accepts the component and its props interface', () => {
    const text = [
      "import { Card } from '@/components/Card';",
      'export interface SettingsViewProps {',
      '  title: string;',
      '}',
      'export const SettingsView: React.FC<SettingsViewProps> = ({ title }) => {',
      '  return <Card>{title}</Card>;',
      '};',
    ].join('\n');
    expect(componentFileProblems(text, 'SettingsView.tsx', 'SettingsView')).toEqual([]);
  });

  it.each([
    'export const SettingsView: FC = () => null;',
    'export const SettingsView = memo(() => null);',
    'export const SettingsView = React.memo(() => null);',
  ])('accepts %s', (text) => {
    expect(componentFileProblems(text, 'SettingsView.tsx', 'SettingsView')).toEqual([]);
  });

  it.each([
    ['export function SettingsView() { return null; }', '"SettingsView" must be an arrow function'],
    ['export const SettingsView = () => null;', '"SettingsView" must be typed as React.FC'],
    ['const SettingsView: React.FC = () => null;', '"SettingsView" must be declared with "export const"'],
    ['export const Other: React.FC = () => null;', 'No component "SettingsView" found'],
  ])('reports %s', (text, problem) => {
    expect(componentFileProblems(text, 'SettingsView.tsx', 'SettingsView').join('\n')).toContain(problem);
  });

  it('reports anything else as one problem, each with its line', () => {
    const text = [
      'export const SettingsView: React.FC = () => null;',
      'function format(value: string) { return value; }',
      'export type Options = { a: string };',
      'export default SettingsView;',
    ].join('\n');
    expect(componentFileProblems(text, 'SettingsView.tsx', 'SettingsView')).toEqual([
      'Only the component "SettingsView" and its props interface "SettingsViewProps" belong here, found 3 other declarations: function "format" (line 2), type "Options" (line 3), default export (line 4).',
    ]);
    expect(componentFileProblems(text.split('\n').slice(0, 2).join('\n'), 'SettingsView.tsx', 'SettingsView')).toEqual([
      'Only the component "SettingsView" and its props interface "SettingsViewProps" belong here, found function "format" (line 2).',
    ]);
  });
});

describe('viewEntryProblems', () => {
  it('accepts re-exports that include Component', () => {
    const text = "export { SettingsView as Component } from './SettingsView';\nexport { loader } from './loader';";
    expect(viewEntryProblems(text, 'index.ts')).toEqual([]);
  });

  it('reports a missing Component export and other code', () => {
    expect(viewEntryProblems("export { SettingsView } from './SettingsView';\nconst x = 1;", 'index.ts')).toEqual([
      'The view is not exported as "Component", which React Router\'s lazy routes need.',
      'Only re-exports ("export { … } from \'…\'") belong here, found constant "x" (line 2).',
    ]);
  });
});

describe('check: views', () => {
  const config = { appFiles: 'app' };
  const VALID = {
    'src/features/docs/index.ts': '',
    'src/app/router.tsx': "import { d } from '@/features/docs'",
    'src/features/docs/views/SettingsView/SettingsView.tsx': 'export const SettingsView: React.FC = () => null;',
    'src/features/docs/views/SettingsView/index.ts': "export { SettingsView as Component } from './SettingsView';",
    'src/app/views/NotFoundView/NotFoundView.tsx': 'export const NotFoundView: React.FC = () => null;',
    'src/app/views/NotFoundView/index.ts': "export { NotFoundView as Component } from './NotFoundView';",
  };

  async function check(tree: Record<string, string>) {
    const root = await createProject(tree, config);
    return (await checkStructure(root)).issues.map((issue) => `${issue.code} ${issue.path}`);
  }

  it('accepts well-formed feature and app views, with styles and tests', async () => {
    expect(
      await check({
        ...VALID,
        'src/features/docs/views/SettingsView/SettingsView.module.css': '',
        'src/features/docs/views/SettingsView/tests/SettingsView.test.tsx': 'it("works", () => {});',
      }),
    ).toEqual([]);
  });

  it('reports view files with other content', async () => {
    const tree = { ...VALID, 'src/features/docs/views/SettingsView/SettingsView.tsx': 'export function SettingsView() { return null; }' };
    expect(await check(tree)).toEqual(['view-file-content src/features/docs/views/SettingsView/SettingsView.tsx']);
  });

  it('reports missing view files and entry points', async () => {
    const tree = {
      ...VALID,
      'src/features/docs/views/BrokenView/index.ts': "export { BrokenView as Component } from './BrokenView';",
      'src/app/views/HomeView/HomeView.tsx': 'export const HomeView: React.FC = () => null;',
    };
    expect(await check(tree)).toEqual([
      'view-entry-missing src/app/views/HomeView',
      'view-file-missing src/features/docs/views/BrokenView',
    ]);
  });

  it('reports entry points that do not export Component', async () => {
    const tree = { ...VALID, 'src/app/views/NotFoundView/index.ts': "export { NotFoundView } from './NotFoundView';" };
    expect(await check(tree)).toEqual(['view-entry-invalid src/app/views/NotFoundView/index.ts']);
  });

  it('accepts api folders with the allowed files', async () => {
    const tree = {
      ...VALID,
      'src/features/docs/views/SettingsView/api/queries.ts': 'export const getSettings = async () => ({});',
    };
    expect(await check(tree)).toEqual([]);
  });

  it('reports empty api folders', async () => {
    expect(await check({ ...VALID, 'src/app/views/NotFoundView/api/': '' })).toEqual(['api-file-missing src/app/views/NotFoundView/api']);
  });

  it('reports mutations and other files in a view api folder', async () => {
    const tree = {
      ...VALID,
      'src/features/docs/views/SettingsView/api/queries.ts': '',
      'src/features/docs/views/SettingsView/api/mutations.ts': '',
      'src/features/docs/views/SettingsView/api/client.ts': '',
      'src/features/docs/views/SettingsView/api/helpers/': '',
    };
    expect(await check(tree)).toEqual([
      'api-unexpected-file src/features/docs/views/SettingsView/api/client.ts',
      'api-unexpected-file src/features/docs/views/SettingsView/api/helpers',
      'api-unexpected-file src/features/docs/views/SettingsView/api/mutations.ts',
    ]);
  });

  it('reports a missing queries file when the api folder only has other files', async () => {
    const tree = { ...VALID, 'src/app/views/NotFoundView/api/queries.tsx': '' };
    expect(await check(tree)).toEqual([
      'api-unexpected-file src/app/views/NotFoundView/api/queries.tsx',
      'api-file-missing src/app/views/NotFoundView/api',
    ]);
  });
});
