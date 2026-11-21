import { describe, expect, it } from 'vitest';
import { treeCommand } from '../../src/commands/tree/command.js';
import { createProject } from '../helpers.js';

const dir = 'src/app/components/Panel';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const PANEL = lines(
  "import styles from './Panel.module.css';",
  "import { Badge } from '../Badge';",
  '',
  'export interface PanelProps {',
  '  title: string;',
  '  open: boolean;',
  '}',
  '',
  'export const Panel: React.FC<PanelProps> = ({ title, open }) => {',
  '  return (',
  '    <section className={styles.root}>',
  '      <h2 className={styles.title}>Hello, {title}!</h2>',
  "      <Badge className={styles.badge} label='soon' tone=\"primary\" active size={2} />",
  '      {open && <p className={styles.note}>Open</p>}',
  '    </section>',
  '  );',
  '};',
);

const CSS = '.root {\n  display: flex;\n  gap: var(--space-4);\n  &:hover {\n    opacity: 0.8;\n  }\n}\n\n.title {\n  font-size: 24px;\n}\n\n.title:hover {\n  color: red;\n}\n';

describe('tree', () => {
  it('describes the elements with their ids, texts, props and the declarations of their own rule', async () => {
    const root = await createProject({ [`${dir}/Panel.tsx`]: PANEL, [`${dir}/Panel.module.css`]: CSS }, { appFiles: 'app' });
    const result = await treeCommand.run({ cwd: root, args: { file: 'app/components/Panel/Panel.tsx' }, options: {} });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe(
      lines(
        'src/app/components/Panel/Panel.tsx',
        'section #root',
        '  h2 #title "Hello, {title}!"',
        '  Badge #badge label="soon" tone="primary" active="true" size="{2}"',
        '  {?open} #root/{?open}',
        '    p #note "Open"',
      ).trimEnd(),
    );
    const data = result.data as { styleFile: string; roots: { style: object; children: { id: string; style?: object; condition?: object; children: object[] }[] }[] };
    expect(data.styleFile).toBe('src/app/components/Panel/Panel.module.css');
    expect(data.roots[0]!.style).toEqual({ display: 'flex', gap: 'var(--space-4)' });
    expect(data.roots[0]!.children[0]).toMatchObject({ id: 'app/components/Panel/Panel.tsx#title', style: { 'font-size': '24px' } });
    expect(data.roots[0]!.children[2]).toMatchObject({ kind: 'condition', condition: { operator: '&&', test: 'open' } });
  });

  it('refuses a file that is not a component', async () => {
    const root = await createProject({ [`${dir}/Panel.tsx`]: 'export const other = 1;\n' }, { appFiles: 'app' });
    const result = await treeCommand.run({ cwd: root, args: { file: 'app/components/Panel/Panel.tsx' }, options: {} });
    expect(result.issues?.map((issue) => issue.code)).toEqual(['element-component-missing']);
  });
});
