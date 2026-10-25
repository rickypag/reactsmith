import { describe, expect, it } from 'vitest';
import { elementRemoveCommand } from '../../src/commands/element/remove/command.js';
import { createProject, read } from '../helpers.js';

const file = 'src/features/docs/components/Sidebar/Sidebar.tsx';
const srcRel = 'features/docs/components/Sidebar/Sidebar.tsx';

const lines = (...text: string[]) => `${text.join('\n')}\n`;

async function remove(text: string, target: string, dryRun = false) {
  const root = await createProject({ [file]: text }, { appFiles: 'root' });
  const result = await elementRemoveCommand.run({ cwd: root, args: { target }, options: { dryRun } });
  return { result, text: await read(root, file) };
}

describe('element remove: components', () => {
  it('removes the usage and its import, leaving no blank line', async () => {
    const before = lines(
      "import { Card } from '@/components/Card';",
      "import { UserMenu } from '../UserMenu';",
      '',
      'export const Sidebar: React.FC = () => {',
      '  return (',
      '    <nav>',
      '      <Card />',
      '      <UserMenu />',
      '    </nav>',
      '  );',
      '};',
    );
    const { result, text } = await remove(before, `${file}:8`);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe(`Removed <UserMenu> from ${file}.`);
    expect(result.actions).toEqual([{ type: 'update', path: file, message: 'removed <UserMenu> from nav and the import of UserMenu' }]);
    expect(text).toBe(
      lines(
        "import { Card } from '@/components/Card';",
        '',
        'export const Sidebar: React.FC = () => {',
        '  return (',
        '    <nav>',
        '      <Card />',
        '    </nav>',
        '  );',
        '};',
      ),
    );
  });

  it('keeps the import while the component is still used, and removes it from a list of imports', async () => {
    const before = lines(
      "import { Item, List } from '../shared';",
      'export const Sidebar: React.FC = () => <nav><Item /><Item /><List /></nav>;',
    );
    const once = await remove(before, `${srcRel}#nav/Item[1]`);
    expect(once.text).toBe(lines("import { Item, List } from '../shared';", 'export const Sidebar: React.FC = () => <nav><Item /><List /></nav>;'));

    const last = await remove(before, `${srcRel}#nav/List`);
    expect(last.text).toBe(lines("import { Item } from '../shared';", 'export const Sidebar: React.FC = () => <nav><Item /><Item /></nav>;'));
  });

  it('leaves no blank line where the only import was', async () => {
    const before = lines("import { Card } from '../Card';", '', 'export const Sidebar: React.FC = () => <div><Card /></div>;');
    expect((await remove(before, `${srcRel}#div/Card`)).text).toBe(lines('export const Sidebar: React.FC = () => <div></div>;'));

    const middle = lines("import { a } from 'a';", '', "import { Card } from '../Card';", '', 'export const Sidebar: React.FC = () => <div><Card /></div>;');
    expect((await remove(middle, `${srcRel}#div/Card`)).text).toBe(
      lines("import { a } from 'a';", '', 'export const Sidebar: React.FC = () => <div></div>;'),
    );
  });

  it('handles default imports next to named ones', async () => {
    const before = lines("import Card, { Row } from '../ui';", 'export const Sidebar: React.FC = () => <div><Card /><Row /></div>;');
    expect((await remove(before, `${srcRel}#div/Card`)).text).toBe(
      lines("import { Row } from '../ui';", 'export const Sidebar: React.FC = () => <div><Row /></div>;'),
    );
    expect((await remove(before, `${srcRel}#div/Row`)).text).toBe(
      lines("import Card from '../ui';", 'export const Sidebar: React.FC = () => <div><Card /></div>;'),
    );
  });

  it('removes any element, and refuses elements not inside a layout or interactive element', async () => {
    const before = lines(
      "import { Button } from '@mui/material';",
      "import { Card } from '../Card';",
      "import { Badge } from '../Badge';",
      'export const Sidebar: React.FC = () => (',
      '  <div>',
      '    <Button />',
      '    <p />',
      '    <Card footer={<Badge />}>',
      '      <Badge />',
      '    </Card>',
      '  </div>',
      ');',
    );
    const code = async (target: string) => (await remove(before, target)).result.issues?.map((issue) => issue.code);
    const button = await remove(before, `${srcRel}#div/Button`);
    expect(button.result.issues).toEqual([]);
    expect(button.text).not.toContain('Button');
    expect(await code(`${srcRel}#div/p`)).toEqual([]);
    expect(await code(`${srcRel}#div/Card/Badge`)).toEqual(['remove-parent-not-layout']);
    expect(await code(`${srcRel}#div/Card/@footer/Badge`)).toEqual(['remove-parent-not-layout']);

    const rootOnly = lines("import { Card } from '../Card';", 'export const Sidebar: React.FC = () => <Card />;');
    expect((await remove(rootOnly, `${srcRel}#Card`)).result.issues?.[0]?.code).toBe('remove-parent-not-layout');
  });

  it('writes nothing with --dry-run', async () => {
    const before = lines("import { Card } from '../Card';", 'export const Sidebar: React.FC = () => <div><Card /></div>;');
    const { result, text } = await remove(before, `${srcRel}#div/Card`, true);
    expect(result.actions).toHaveLength(1);
    expect(text).toBe(before);
  });
});
