import { describe, expect, it } from 'vitest';
import { componentCreateCommand } from '../../src/commands/component/create/command.js';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { createProject } from '../helpers.js';

const TREE = {
  'src/app/components/TopBar/TopBar.tsx': "import styles from './TopBar.module.css';\n\nexport const TopBar: React.FC = () => {\n  return <header className={styles.root} />;\n};\n",
  'src/app/components/TopBar/TopBar.module.css': '.root {\n}\n',
  'src/app/components/TopBar/index.ts': "export { TopBar } from './TopBar';\n",
  'src/app/components/Badge/Badge.tsx': "export interface BadgeProps {\n  children?: React.ReactNode;\n}\n\nexport const Badge: React.FC<BadgeProps> = ({ children }) => <div>{children}</div>;\n",
  'src/app/components/Badge/index.ts': "export { Badge } from './Badge';\n",
};

describe('hints that point to the way that works', () => {
  it('suggests a string prop when a text root is given children', async () => {
    const root = await createProject({}, { appFiles: 'app' });
    const result = await componentCreateCommand.run({
      cwd: root,
      args: { name: 'Chip' },
      options: { feature: undefined, app: true, type: undefined, interface: 'children: React.ReactNode', rootProps: undefined, from: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, root: 'span', text: undefined, jsx: undefined, replace: false, dryRun: false },
    });
    expect(result.issues?.map((issue) => issue.code)).toEqual(['root-children-not-allowed']);
    expect(result.issues?.[0]?.hint).toContain('--interface "label: string" --root span --text "{label}"');
  });

  it('says that a component taking children holds elements, when given text', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    const result = await elementInsertCommand.run({
      cwd: root,
      args: { name: 'Badge' },
      options: { into: 'app/components/TopBar/TopBar.tsx#root', around: undefined, through: undefined, if: undefined, fallback: undefined, position: undefined, from: undefined, props: undefined, text: 'v0.1', message: undefined, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
    });
    expect(result.issues?.map((issue) => issue.code)).toEqual(['element-text-not-allowed']);
    expect(result.issues?.[0]?.message).toBe('<Badge> takes children, which hold elements, not text.');
    expect(result.issues?.[0]?.hint).toContain('element insert span --into <the Badge>');
  });
});
