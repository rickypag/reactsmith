import { describe, expect, it } from 'vitest';
import { elementRemoveCommand } from '../../src/commands/element/remove/command.js';
import { createProject, read } from '../helpers.js';

const file = 'src/app/components/TopBar/TopBar.tsx';
const id = 'app/components/TopBar/TopBar.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const TOP_BAR = lines(
  "import { UserMenu } from '../UserMenu';",
  "import styles from './TopBar.module.css';",
  '',
  'export const TopBar: React.FC = () => {',
  '  return (',
  '    <header className={styles.root}>',
  '      <span>TopBar</span>',
  '      <div>',
  '        <UserMenu />',
  '      </div>',
  '    </header>',
  '  );',
  '};',
);

async function remove(target: string, text = TOP_BAR) {
  const root = await createProject({ [file]: text }, { appFiles: 'app' });
  const result = await elementRemoveCommand.run({ cwd: root, args: { target }, options: { dryRun: false } });
  return { result, text: await read(root, file) };
}

describe('element remove', () => {
  it('removes an element with its lines', async () => {
    const { result, text } = await remove(`${id}#header/span`);
    expect(result.summary).toBe(`Removed <span> from ${file}.`);
    expect(text).toBe(TOP_BAR.replace('      <span>TopBar</span>\n', ''));
  });

  it('removes the imports of components that were only inside it', async () => {
    const { result, text } = await remove(`${id}#header/div`);
    expect(result.actions).toEqual([{ type: 'update', path: file, message: 'removed <div> from header and the import of UserMenu' }]);
    expect(text).toBe(
      lines(
        "import styles from './TopBar.module.css';",
        '',
        'export const TopBar: React.FC = () => {',
        '  return (',
        '    <header className={styles.root}>',
        '      <span>TopBar</span>',
        '    </header>',
        '  );',
        '};',
      ),
    );
  });

  it('refuses the root and elements outside layout elements', async () => {
    expect((await remove(`${id}#header`)).result.issues?.map((issue) => issue.code)).toEqual(['remove-parent-not-layout']);
    const inText = TOP_BAR.replace('<span>TopBar</span>', '<p><strong>Top</strong></p>');
    expect((await remove(`${id}#header/p/strong`, inText)).result.issues?.map((issue) => issue.code)).toEqual(['remove-parent-not-layout']);
  });
});
