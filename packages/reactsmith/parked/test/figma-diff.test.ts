import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain script of the Figma skill, without types.
import { designTree, diffDesigns, outOfOrder } from '../../skills/reactsmith-from-figma/diff.mjs';

const ROOT = '430:1';
const FILE = 'features/docs/views/PageView/PageView.tsx';

type Layer = Record<string, unknown>;
const text = (name: string, characters: string, extra: Layer = {}): Layer => ({ id: `t-${name}`, name, type: 'TEXT', characters, style: { fontSize: 14, fontWeight: 400 }, ...extra });
const instance = (name: string, componentId: string, props: Record<string, unknown>): Layer => ({ id: `i-${name}`, name, type: 'INSTANCE', componentId, componentProperties: props });
const frame = (name: string, children: Layer[], extra: Layer = {}): Layer => ({ id: `f-${name}`, name, type: 'FRAME', layoutMode: 'VERTICAL', itemSpacing: 8, children, ...extra });

/** An export of one screen, with the components its instances use. */
function bundle(children: Layer[], at: string) {
  return {
    format: 'reactsmith-figma/1',
    exportedAt: at,
    roots: [ROOT],
    nodes: {
      [ROOT]: {
        document: frame('Page', children),
        components: {
          'c:card': { name: 'cards/Card', description: 'root: article' },
          'c:folder': { name: 'folder-tree', description: 'Lucide folder-tree' },
          'c:bot': { name: 'bot', description: 'Lucide bot' },
        },
        componentSets: {},
      },
    },
    variables: { v1: { name: 'text-muted' } },
  };
}

/** The code's description, as "reactsmith tree --json" gives it: a root with named children. */
function code(children: { name: string; tag?: string; text?: string; props?: Record<string, string>; style?: Record<string, string>; children?: unknown[] }[]) {
  const element = (child: (typeof children)[number]): unknown => ({ id: `${FILE}#${child.name}`, kind: 'element', tag: child.tag ?? 'p', name: child.name, text: child.text, props: child.props, style: child.style, children: (child.children ?? []).map((nested) => element(nested as (typeof children)[number])) });
  return { file: `src/${FILE}`, component: 'PageView', roots: [{ id: `${FILE}#root`, kind: 'element', tag: 'div', name: 'root', children: children.map(element) }] };
}

const run = (before: Layer[], after: Layer[], current: Parameters<typeof code>[0]) =>
  diffDesigns(designTree(bundle(before, '1'), ROOT), designTree(bundle(after, '2'), ROOT), code(current)) as { commands: { why: string; command: string }[]; decisions: string[] };

describe('diff.mjs: changes in the design become commands', () => {
  it('finds the fewest moves to put elements in order', () => {
    // b or c: either single move puts them in order.
    expect(outOfOrder(['a', 'b', 'c', 'd'], ['a', 'c', 'b', 'd'])).toHaveLength(1);
    expect(outOfOrder(['d', 'a', 'b', 'c'], ['a', 'b', 'c', 'd'])).toEqual(['d']);
    expect(outOfOrder(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('moves what the design reordered, and leaves an order only the code has', () => {
    const a = text('p: a', 'A');
    const b = text('p: b', 'B');
    const c = text('p: c', 'C');
    const moved = run([a, b, c], [b, a, c], [{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    expect(moved.commands.map((item) => item.command)).toEqual([`./node_modules/.bin/reactsmith element move "${FILE}#a" --into "${FILE}#b" --position after`]);
    // The code put c first on purpose; the design didn't change: nothing moves.
    expect(run([a, b, c], [a, b, c], [{ name: 'c' }, { name: 'a' }, { name: 'b' }]).commands).toEqual([]);
  });

  it('updates instance values, icons included, and style values', () => {
    const before = [instance('feature', 'c:card', { 'title#1': { type: 'TEXT', value: 'Old' }, 'icon#2': { type: 'INSTANCE_SWAP', value: 'c:folder' } }), text('p: lead', 'Lead', { fills: [{ type: 'SOLID', boundVariables: { color: { id: 'v1' } } }] })];
    const after = [instance('feature', 'c:card', { 'title#1': { type: 'TEXT', value: "It's new" }, 'icon#2': { type: 'INSTANCE_SWAP', value: 'c:bot' } }), text('p: lead', 'Lead', { style: { fontSize: 16, fontWeight: 400 }, fills: [{ type: 'SOLID', boundVariables: { color: { id: 'v1' } } }] })];
    const result = run(before, after, [{ name: 'feature', tag: 'Card', props: { title: 'Old', icon: '{FolderTreeIcon}' } }, { name: 'lead', text: 'Lead', style: { 'font-size': '14px' } }]);
    expect(result.commands.map((item) => item.command)).toEqual([
      `./node_modules/.bin/reactsmith element update "${FILE}#feature" --props "title=\\"It's new\\" icon={BotIcon}"`,
      `./node_modules/.bin/reactsmith style update "${FILE}#lead" --css "font-size: 16px"`,
    ]);
  });

  it('inserts new texts and instances after their neighbor, and moves an element into another frame', () => {
    const before = [text('h2: title', 'Title'), frame('div: box', [])];
    const after = [text('h2: title', 'Title'), text('p: intro', 'Intro'), instance('card', 'c:card', { 'title#1': { type: 'TEXT', value: 'One' } }), frame('div: box', [text('h2: title2', 'X')])];
    const result = run(before, after, [{ name: 'title', tag: 'h2', text: 'Title' }, { name: 'box', tag: 'div' }]);
    const commands = result.commands.map((item) => item.command);
    expect(commands[0]).toBe(`./node_modules/.bin/reactsmith element insert p --into "${FILE}#title" --position after --text "Intro" --name intro`);
    expect(commands).toContain(`./node_modules/.bin/reactsmith element insert Card --into "${FILE}#intro" --position after --props "title='One'" --name card`);
    expect(commands).toContain(`./node_modules/.bin/reactsmith element insert h2 --into "${FILE}#box" --position first --text "X" --name title2`);

    const nested = run([text('h2: title', 'Title'), frame('div: box', [])], [frame('div: box', [text('h2: title', 'Title')])], [{ name: 'title', tag: 'h2', text: 'Title' }, { name: 'box', tag: 'div' }]);
    expect(nested.commands.map((item) => item.command)).toEqual([`./node_modules/.bin/reactsmith element move "${FILE}#title" --into "${FILE}#box"`]);
  });

  it('leaves what needs a choice as decisions: new frames, unnamed layers, texts shown from values', () => {
    const before = [text('p: label', 'Hello'), text('Text', 'loose')];
    const after = [text('p: label', 'Hi'), text('Text', 'loose, changed'), frame('div: panel', [])];
    const result = run(before, after, [{ name: 'label', text: '{label}' }]);
    expect(result.commands).toEqual([]);
    expect(result.decisions).toHaveLength(3);
    expect(result.decisions.join('\n')).toMatch(/#panel: a new frame/);
    expect(result.decisions.join('\n')).toMatch(/"Text" in "root": changed, without a name/);
    expect(result.decisions.join('\n')).toMatch(/#label: its text changed .* but the code shows a value/);
  });

  it('removes only what the code has, and nothing twice', () => {
    const result = run([text('p: a', 'A'), text('p: b', 'B')], [text('p: a', 'A')], [{ name: 'a', text: 'A' }]);
    expect(result.commands).toEqual([]);
  });
});
