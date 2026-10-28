import { describe, expect, it } from 'vitest';
import { styleUpdateCommand } from '../../src/commands/style/update/command.js';
import { createProject, read } from '../helpers.js';

const dir = 'src/app/components/NavItem';
const file = `${dir}/NavItem.tsx`;
const css = `${dir}/NavItem.module.css`;
const id = 'app/components/NavItem/NavItem.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const NAV_ITEM = lines(
  "import { NavLink } from 'react-router';",
  "import styles from './NavItem.module.css';",
  '',
  'export interface NavItemProps {',
  '  label: string;',
  '  to: string;',
  '  selected: boolean;',
  "  status: 'ok' | 'error';",
  '}',
  '',
  'export const NavItem: React.FC<NavItemProps> = ({ to, label }) => {',
  '  return (',
  '    <NavLink className={styles.root} to={to}>',
  '      <span className={styles.label}>{label}</span>',
  '    </NavLink>',
  '  );',
  '};',
);

async function project(text = NAV_ITEM, config: object = {}) {
  return createProject({ [file]: text, [css]: '.root {\n  color: #A3AED0;\n}\n\n.label {\n}\n', [`${dir}/index.ts`]: "export { NavItem } from './NavItem';\n" }, { appFiles: 'app', ...config });
}

function style(root: string, target: string, when: string, cssText: string, state?: 'hover') {
  return styleUpdateCommand.run({
    cwd: root,
    args: { target },
    options: { name: undefined, state, css: cssText, cssFile: undefined, object: undefined, objectFile: undefined, class: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, when, dryRun: false },
  });
}

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);

describe('style update --when', () => {
  it('styles the root by a boolean prop, which the root shows as a data attribute', async () => {
    const root = await project();
    const result = await style(root, `${id}#root`, 'selected', 'color: #4318FF');
    expect(result.issues).toEqual([]);
    const text = await read(root, file);
    expect(text).toContain('= ({ to, label, selected }) =>');
    expect(text).toContain('<NavLink className={styles.root} to={to} data-selected={selected}>');
    expect(await read(root, css)).toContain('.root[data-selected="true"] {\n  color: #4318FF;\n}');
  });

  it('styles a child by the same prop, without adding the attribute twice', async () => {
    const root = await project();
    await style(root, `${id}#root`, 'selected', 'color: #4318FF');
    expect((await style(root, `${id}#label`, 'selected', 'color: #2B3674')).issues).toEqual([]);
    expect((await read(root, file)).match(/data-selected/g)).toHaveLength(1);
    expect(await read(root, css)).toContain('.root[data-selected="true"] .label {\n  color: #2B3674;\n}');
  });

  it('takes a value for props that are not booleans, and a state on top', async () => {
    const root = await project();
    await style(root, `${id}#label`, 'status=error', 'color: #EE5D50');
    await style(root, `${id}#root`, 'selected', 'opacity: 0.8', 'hover');
    const styles = await read(root, css);
    expect(styles).toContain('.root[data-status="error"] .label {\n  color: #EE5D50;\n}');
    expect(styles).toContain('.root[data-selected="true"]:hover {\n  opacity: 0.8;\n}');
    expect(await read(root, file)).toContain('data-status={status} data-selected={selected}>');
  });

  it('refuses an unknown prop, a value missing for a non-boolean, and Tailwind', async () => {
    const root = await project();
    expect(codes(await style(root, `${id}#root`, 'open', 'color: red'))).toEqual(['when-prop-unknown']);
    expect(codes(await style(root, `${id}#root`, 'status', 'color: red'))).toEqual(['when-value-required']);
    expect(codes(await style(root, `${id}#root`, 'status=a"b', 'color: red'))).toEqual(['when-invalid']);
    expect(await read(root, file)).toBe(NAV_ITEM);
    const tailwind = await createProject({ [file]: NAV_ITEM, [`${dir}/NavItem.styles.ts`]: "export const styles = {\n  root: '',\n};\n" }, { appFiles: 'app', styles: 'tailwind' });
    expect(codes(await style(tailwind, `${id}#root`, 'selected', 'color: red'))).toEqual(['when-not-tailwind']);
  });

  it('refuses a root that is a component of the project, which would not pass the attribute on', async () => {
    const card = NAV_ITEM.replace("import { NavLink } from 'react-router';", "import { Card } from '@/components/cards';").replace('<NavLink className={styles.root} to={to}>', '<Card className={styles.root}>').replace('</NavLink>', '</Card>');
    const root = await project(card);
    expect(codes(await style(root, `${id}#label`, 'selected', 'color: red'))).toEqual(['when-root-component']);
  });

  it('styles the root of a styleable component, written with cx', async () => {
    const root = await project(NAV_ITEM.replace('className={styles.root}', 'className={cx(styles.root, className)}'));
    expect((await style(root, `${id}#root`, 'selected', 'color: #4318FF')).issues).toEqual([]);
    expect(await read(root, css)).toContain('.root[data-selected="true"]');
  });
});
