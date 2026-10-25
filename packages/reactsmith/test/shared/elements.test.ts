import { describe, expect, it } from 'vitest';
import { idCommand } from '../../src/commands/id/command.js';
import { validateConfig } from '../../src/shared/config/validate.js';
import { resolveTarget } from '../../src/shared/elements/ids.js';
import { allNodes } from '../../src/shared/elements/tree.js';
import type { IssueError } from '../../src/shared/issues.js';
import { createProject } from '../helpers.js';

const file = 'src/features/docs/components/Sidebar/Sidebar.tsx';
const srcRel = 'features/docs/components/Sidebar/Sidebar.tsx';

const SIDEBAR = [
  "import { Card } from '@/components/Card';", // 1
  "import { ListItem } from './ListItem';", // 2
  '', // 3
  'export const Sidebar: React.FC = () => {', // 4
  '  const title = "Docs";', // 5
  '  return (', // 6
  '    <div>', // 7
  '      <header><h1>{title}</h1></header>', // 8
  '      <>', // 9
  '        <nav>', // 10
  '          <ListItem />', // 11
  '          <ListItem', // 12
  '            label="Two"', // 13
  '          />', // 14
  '        </nav>', // 15
  '      </>', // 16
  '      <Card footer={<button>Save</button>}>', // 17
  '        <p>Body</p>', // 18
  '      </Card>', // 19
  '    </div>', // 20
  '  );', // 21
  '};', // 22
].join('\n');

const config = validateConfig({}).config!;

async function target(value: string, text = SIDEBAR) {
  const root = await createProject({ [file]: text, 'package.json': '{}' });
  return resolveTarget(root, config, value);
}

async function failure(value: string, text = SIDEBAR) {
  try {
    await target(value, text);
  } catch (error) {
    const [issue] = (error as IssueError).issues;
    return `${issue!.code}: ${issue!.message} ${issue!.hint ?? ''}`.trim();
  }
  throw new Error('expected a failure');
}

describe('element tree', () => {
  it('names each element by its tags from the root, through fragments, with slots for JSX props', async () => {
    const { tree } = await target(`${file}:7`);
    expect(allNodes(tree.roots).map((node) => `${node.path}${node.layout ? ' (layout)' : ''}`)).toEqual([
      'div (layout)',
      'div/header (layout)',
      'div/header/h1',
      'div/nav (layout)',
      'div/nav/ListItem[1]',
      'div/nav/ListItem[2]',
      'div/Card',
      'div/Card/@footer',
      'div/Card/@footer/button (layout)',
      'div/Card/p',
    ]);
  });

  it('handles components returning JSX directly, and wrapped in memo', async () => {
    const direct = 'export const Sidebar: React.FC = () => <nav><a /></nav>;';
    expect((await target(`${srcRel}#nav/a`, direct)).element.tag).toBe('a');
    const memo = 'export const Sidebar = memo(() => { return <nav><a /></nav>; });';
    expect((await target(`${srcRel}#nav/a`, memo)).element.tag).toBe('a');
  });
});

describe('resolveTarget', () => {
  it('resolves ids, with the file relative to src, the project or absolute', async () => {
    const result = await target(`${srcRel}#div/nav/ListItem[2]`);
    expect(result.id).toBe(`${srcRel}#div/nav/ListItem[2]`);
    expect(result.file).toBe(file);
    expect(result.element.start).toEqual({ line: 12, column: 11 });
    expect((await target(`${file}#div/Card/@footer/button`)).id).toBe(`${srcRel}#div/Card/@footer/button`);
  });

  it.each([
    [7, 'div'],
    [11, 'div/nav/ListItem[1]'],
    [13, 'div/nav/ListItem[2]'], // inside a multi-line element: the innermost one containing the line
    [18, 'div/Card/p'],
    [5, undefined], // not in the JSX
  ])('locates line %i', async (line, path) => {
    if (path) expect((await target(`${file}:${line}`)).id).toBe(`${srcRel}#${path}`);
    else expect(await failure(`${file}:${line}`)).toMatch(/^element-not-found/);
  });

  it('asks for the column when several elements start on the line, and uses it', async () => {
    expect(await failure(`${file}:8`)).toBe(
      `element-line-ambiguous: 2 elements start on ${file}:8. Add the column: 7 (div/header), 15 (div/header/h1).`,
    );
    expect((await target(`${file}:8:15`)).id).toBe(`${srcRel}#div/header/h1`);
    expect((await target(`${file}:8:20`)).id).toBe(`${srcRel}#div/header/h1`);
  });

  it('explains ambiguous and stale ids', async () => {
    expect(await failure(`${srcRel}#div/nav/ListItem`)).toBe(
      'element-id-ambiguous: "ListItem" in Sidebar/div/nav matches 2 elements. Add an index: ListItem[1], ListItem[2].',
    );
    expect(await failure(`${srcRel}#div/aside`)).toBe(
      'element-not-found: No element "aside" in Sidebar/div. The code may have changed: choose from: header, nav, Card.',
    );
    expect(await failure(`${srcRel}#div/nav/ListItem[3]`)).toMatch(/^element-not-found/);
  });

  it('rejects files outside src, missing files and files without the component', async () => {
    expect(await failure('package.json:1')).toMatch(/^element-file-outside-src/);
    expect(await failure('features/docs/Nope.tsx:1')).toMatch(/^element-file-missing/);
    expect(await failure(`${file}:1`, 'export const Other: React.FC = () => <div />;')).toMatch(/^element-component-missing/);
    expect(await failure('Sidebar.tsx')).toMatch(/^element-target-invalid/);
  });
});

describe('id command', () => {
  it('prints the id and returns it with the element for agents', async () => {
    const root = await createProject({ [file]: SIDEBAR });
    const result = await idCommand.run({ cwd: root, args: { target: `${file}:10` }, options: {} });
    expect(result).toEqual({
      ok: true,
      summary: `${srcRel}#div/nav`,
      data: { id: `${srcRel}#div/nav`, file, tag: 'nav', layout: true, line: 10, column: 9 },
    });
  });
});
