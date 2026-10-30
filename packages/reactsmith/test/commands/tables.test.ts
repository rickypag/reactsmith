import { describe, expect, it } from 'vitest';
import { componentCreateCommand } from '../../src/commands/component/create/command.js';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { elementUpdateCommand } from '../../src/commands/element/update/command.js';
import { styleUpdateCommand } from '../../src/commands/style/update/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read } from '../helpers.js';

const dir = 'src/features/docs/components/PriceTable';
const file = `${dir}/PriceTable.tsx`;
const id = 'features/docs/components/PriceTable/PriceTable.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const PRICE_TABLE = lines(
  "import styles from './PriceTable.module.css';",
  '',
  'export const PriceTable: React.FC = () => {',
  '  return (',
  '    <table className={styles.root}>',
  '      <thead>',
  '        <tr>',
  '          <th>Plan</th>',
  '          <th>Price</th>',
  '        </tr>',
  '      </thead>',
  '      <tbody className={styles.rows}>',
  '        <tr className={styles.row}>',
  '          <td className={styles.plan}>Free</td>',
  '        </tr>',
  '      </tbody>',
  '    </table>',
  '  );',
  '};',
);

/** A stand-in for lucide-react with one icon. */
const LUCIDE = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { 'lucide-react': '*' } }),
  'node_modules/lucide-react/package.json': '{ "name": "lucide-react", "main": "index.js", "types": "index.d.ts" }',
  'node_modules/lucide-react/index.js': 'const icon = {};\nmodule.exports = { Check: icon, CheckIcon: icon, LucideCheck: icon };\n',
  'node_modules/lucide-react/index.d.ts': 'export declare const Check: () => null;\nexport declare const CheckIcon: () => null;\nexport declare const LucideCheck: () => null;\n',
};

async function project(text = PRICE_TABLE) {
  return createProject(
    {
      ...LUCIDE,
      'src/features/docs/index.ts': '',
      [file]: text,
      [`${dir}/PriceTable.module.css`]: '.root {\n}\n\n.rows {\n}\n\n.row {\n}\n\n.plan {\n}\n',
      [`${dir}/index.ts`]: "export { PriceTable } from './PriceTable';\n",
    },
    { appFiles: 'app', icons: { library: 'lucide-react' } },
  );
}

async function insert(root: string, tag: string, into: string, options: { text?: string; direction?: 'row' | 'column'; name?: string } = {}) {
  return elementInsertCommand.run({
    cwd: root,
    args: { name: tag },
    options: { around: undefined, through: undefined, if: undefined, fallback: undefined, into, position: undefined, from: undefined, props: undefined, text: options.text, name: options.name, direction: options.direction, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
  });
}

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);

describe('tables', () => {
  it('builds a table: cells into rows, text into cells, and check accepts it', async () => {
    const root = await project();
    expect(codes(await insert(root, 'td', `${id}#row`, { text: '$0' }))).toEqual([]);
    expect(codes(await insert(root, 'tr', `${id}#rows`))).toEqual([]);
    expect(codes(await insert(root, 'strong', `${id}#plan`, { text: 'New' }))).toEqual([]);
    expect(await read(root, file)).toContain('<td>$0</td>');
    expect((await checkStructure(root)).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('refuses what does not belong where it goes', async () => {
    const root = await project();
    const span = await insert(root, 'span', `${id}#row`, { text: 'x' });
    expect(span.issues?.map((issue) => [issue.code, issue.message, issue.hint])).toEqual([
      ['table-content-invalid', '<tr> holds only <td>, <th> (or components rendering them), not <span>.', 'Put it in a cell: a <td>, or a <th> for a header.'],
    ]);
    expect(codes(await insert(root, 'td', `${id}#rows`))).toEqual(['table-content-invalid']);
    expect((await insert(root, 'td', `${id}#plan`)).issues?.[0]?.message).toBe('<td> goes only into <tr>, not into <td>.');
    expect(await read(root, file)).toBe(PRICE_TABLE);
  });

  it('gives table elements no layout options: the table lays them out', async () => {
    const root = await project();
    expect(codes(await insert(root, 'tr', `${id}#rows`, { name: 'extra', direction: 'row' }))).toEqual(['layout-not-allowed']);
    const style = await styleUpdateCommand.run({
      cwd: root,
      args: { target: `${id}#row` },
      options: { name: undefined, state: undefined, css: undefined, cssFile: undefined, object: undefined, objectFile: undefined, class: undefined, direction: 'row', gap: undefined, align: undefined, justify: undefined, padding: undefined, when: undefined, dryRun: false },
    });
    expect(codes(style)).toEqual(['layout-not-allowed']);
  });

  it('creates a row component without a flex layout, and refuses layout options for it', async () => {
    const root = await project();
    const create = (direction?: 'row') =>
      componentCreateCommand.run({
        cwd: root,
        args: { name: 'PriceRow' },
        options: { feature: 'docs', app: false, type: undefined, interface: 'plan: string', rootProps: undefined, from: undefined, direction, gap: undefined, align: undefined, justify: undefined, padding: undefined, root: 'tr', text: undefined, dryRun: false },
      });
    expect(codes(await create('row'))).toEqual(['layout-not-allowed']);
    expect(codes(await create())).toEqual([]);
    expect(await read(root, 'src/features/docs/components/PriceRow/PriceRow.module.css')).toBe('.root {\n}\n');
  });

  it('puts icons into cells, not rows, and keeps them when the text of the cell changes', async () => {
    const root = await project();
    const icon = (into: string) =>
      elementInsertCommand.run({
        cwd: root,
        args: { name: 'CheckIcon' },
        options: { around: undefined, through: undefined, if: undefined, fallback: undefined, into, position: 'first', from: undefined, props: undefined, text: undefined, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
      });
    expect(codes(await icon(`${id}#row`))).toEqual(['table-content-invalid']);
    expect(codes(await icon(`${id}#plan`))).toEqual([]);
    const update = await elementUpdateCommand.run({ cwd: root, args: { target: `${id}#plan` }, options: { text: 'Starter', props: undefined, removeProps: undefined, dryRun: false } });
    expect(codes(update)).toEqual([]);
    expect(await read(root, file)).toContain('<td className={styles.plan}><CheckIcon />Starter</td>');
  });

  it('reports content a table can not hold', async () => {
    const root = await project(PRICE_TABLE.replace('<td className={styles.plan}>Free</td>', '<span>Free</span>'));
    const issues = (await checkStructure(root)).issues.filter((issue) => issue.code === 'table-content-invalid');
    expect(issues.map((issue) => issue.message)).toEqual(['<tr> holds only <td>, <th> (or components rendering them), not <span>. (line 14)']);
  });
});
