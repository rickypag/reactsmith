import { describe, expect, it } from 'vitest';
import { componentCreateCommand } from '../../src/commands/component/create/command.js';
import { componentRemoveCommand } from '../../src/commands/component/remove/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, exists, read } from '../helpers.js';

const buttons = 'src/components/buttons';
const sidebar = 'src/app/components/Sidebar/Sidebar.tsx';

const create = (root: string, name: string, options: { feature?: string; app?: boolean; type?: string; interface?: string }) =>
  componentCreateCommand.run({
    cwd: root,
    args: { name },
    options: { feature: options.feature, app: options.app ?? false, type: options.type, interface: options.interface, rootProps: undefined, from: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, root: undefined, text: undefined, dryRun: false },
  });

const remove = (root: string, target: string, dryRun = false) => componentRemoveCommand.run({ cwd: root, args: { target }, options: { dryRun } });

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);

describe('component remove', () => {
  it('deletes an unused component with its folder', async () => {
    const root = await createProject({}, { appFiles: 'app' });
    await create(root, 'Sidebar', { app: true });
    expect(await exists(root, sidebar)).toBe(true);

    const dry = await remove(root, 'Sidebar', true);
    expect(dry.actions?.map((action) => `${action.type} ${action.path}`)).toEqual([
      'delete src/app/components/Sidebar/Sidebar.module.css',
      'delete src/app/components/Sidebar/Sidebar.tsx',
      'delete src/app/components/Sidebar/index.ts',
    ]);
    expect(await exists(root, sidebar)).toBe(true);

    const result = await remove(root, 'app/components/Sidebar');
    expect(result.summary).toBe('Removed "Sidebar" (src/app/components/Sidebar).');
    expect(await exists(root, 'src/app/components/Sidebar')).toBe(false);
  });

  it('takes a shared component out of the barrel of its type, and the barrel with the last one', async () => {
    const root = await createProject({}, { appFiles: 'app' });
    await create(root, 'PrimaryButton', { type: 'buttons', interface: 'label: string' });
    await create(root, 'IconButton', { type: 'buttons' });

    expect(codes(await remove(root, 'PrimaryButton'))).toEqual([]);
    expect(await read(root, `${buttons}/index.ts`)).toBe("export { IconButton } from './IconButton';\n");
    expect(await exists(root, `${buttons}/PrimaryButton`)).toBe(false);

    expect(codes(await remove(root, 'IconButton'))).toEqual([]);
    expect(await exists(root, buttons)).toBe(false);
    expect((await checkStructure(root)).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('refuses a component still imported, by its folder, its type barrel or for a type', async () => {
    const using = (line: string) => ({ [sidebar]: `${line}\n\nexport const Sidebar: React.FC = () => <aside />;\n` });
    const cases = [
      "import { PrimaryButton } from '@/components/buttons';",
      "import type { PrimaryButtonProps } from '@/components/buttons';",
      "import { PrimaryButton } from '@/components/buttons/PrimaryButton';",
    ];
    for (const line of cases) {
      const project = await createProject({ ...using(line) }, { appFiles: 'app' });
      await create(project, 'PrimaryButton', { type: 'buttons', interface: 'label: string' });
      const result = await remove(project, 'PrimaryButton');
      expect(codes(result)).toEqual(['component-in-use']);
      expect(result.issues?.[0]?.message).toBe(`"PrimaryButton" is still imported by ${sidebar}.`);
      expect(await exists(project, `${buttons}/PrimaryButton/PrimaryButton.tsx`)).toBe(true);
    }

    // Another component of the same barrel does not hold it.
    const other = await createProject(using("import { IconButton } from '@/components/buttons';"), { appFiles: 'app' });
    await create(other, 'PrimaryButton', { type: 'buttons' });
    await create(other, 'IconButton', { type: 'buttons' });
    expect(codes(await remove(other, 'PrimaryButton'))).toEqual([]);
  });

  it('refuses an unknown target', async () => {
    const root = await createProject({}, { appFiles: 'app' });
    expect(codes(await remove(root, 'Nothing'))).toEqual(['component-missing']);
  });
});
