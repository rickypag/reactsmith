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

const css = 'src/app/components/TopBar/TopBar.module.css';

async function remove(target: string, text = TOP_BAR, styles?: string) {
  const root = await createProject({ [file]: text, ...(styles === undefined ? {} : { [css]: styles }) }, { appFiles: 'app' });
  const result = await elementRemoveCommand.run({ cwd: root, args: { target }, options: { keepChildren: false, dryRun: false } });
  return { result, text: await read(root, file), styles: styles === undefined ? undefined : await read(root, css) };
}

describe('element remove', () => {
  it('removes an element with its lines', async () => {
    const { result, text } = await remove(`${id}#header/span`);
    expect(result.summary).toBe(`Removed <span> from ${file}.`);
    expect(text).toBe(TOP_BAR.replace('      <span>TopBar</span>\n', ''));
  });

  it('removes the imports of components that were only inside it', async () => {
    const { result, text } = await remove(`${id}#header/div`);
    expect(result.actions).toEqual([{ type: 'update', path: file, message: 'removed <div> from #root and the import of UserMenu' }]);
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

  it('removes the styles of the element and of the named elements inside it, when nothing else uses them', async () => {
    const named = TOP_BAR.replace('<span>TopBar</span>', '<span className={styles.brand}>TopBar</span>')
      .replace('      <div>\n', '      <div className={styles.end}>\n')
      .replace('<UserMenu />', '<UserMenu />\n        <span className={styles.label}>Me</span>\n        <span className={styles.brand}>Again</span>');
    const styles = lines(
      '.root {',
      '  display: flex;',
      '}',
      '',
      '.brand {',
      '  font-weight: 600;',
      '}',
      '',
      '.end {',
      '  display: flex;',
      '  &:hover {',
      '    opacity: 0.8;',
      '  }',
      '}',
      '',
      '.end:hover {',
      '  color: red;',
      '}',
      '',
      '/* the label in a selected top bar */',
      '.root[data-selected="true"] .label {',
      '  color: blue;',
      '}',
      '',
      '.root:has(.label) {',
      '  gap: 4px;',
      '}',
      '',
      '.label {',
      '  color: gray;',
      '}',
    );
    const { result, styles: after } = await remove(`${id}#end`, named, styles);
    expect(result.actions?.map((action) => action.message)).toEqual([
      'removed the styles "end", "label", which nothing uses now',
      'removed <div> from #root and the import of UserMenu and the styles "end", "label"',
    ]);
    // brand is still used by the span left in the header; a rule that only mentions label stays.
    expect(after).toBe(lines('.root {', '  display: flex;', '}', '', '.brand {', '  font-weight: 600;', '}', '', '.root:has(.label) {', '  gap: 4px;', '}'));
  });
});
