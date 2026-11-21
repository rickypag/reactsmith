import { describe, expect, it } from 'vitest';
import type { StyleState } from '../../src/shared/styles/declarations.js';
import { styleUpdateCommand } from '../../src/commands/style/update/command.js';
import { parseCss, parseStyleObject } from '../../src/shared/styles/declarations.js';
import { createProject, read, issuesOfUsedCode } from '../helpers.js';

const dir = 'src/app/components/TopBar';
const file = `${dir}/TopBar.tsx`;
const css = `${dir}/TopBar.module.css`;
const id = 'app/components/TopBar/TopBar.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const TOP_BAR = lines(
  "import styles from './TopBar.module.css';",
  '',
  'export const TopBar: React.FC = () => {',
  '  return (',
  '    <header className={styles.root}>',
  '      <a href="/docs">Docs</a>',
  '      <span className="brand">ReactSmith</span>',
  '    </header>',
  '  );',
  '};',
);
const TOP_BAR_CSS = lines('.root {', '  display: flex;', '  gap: var(--space-2);', '  height: 3.5rem;', '}');

interface Options {
  name?: string;
  state?: StyleState;
  css?: string;
  cssFile?: string;
  object?: string;
  objectFile?: string;
  class?: string;
  gap?: string;
  direction?: 'row' | 'column' | 'none';
  when?: string;
  at?: string;
  dryRun?: boolean;
}

async function update(target: string, options: Options, tree: Record<string, string> = {}, config: object = {}) {
  const root = await createProject({ [file]: TOP_BAR, [css]: TOP_BAR_CSS, [`${dir}/index.ts`]: "export { TopBar } from './TopBar';\n", ...tree }, { appFiles: 'app', ...config });
  const result = await styleUpdateCommand.run({
    cwd: root,
    args: { target },
    options: {
      name: options.name,
      state: options.state,
      css: options.css,
      cssFile: options.cssFile,
      object: options.object,
      objectFile: options.objectFile,
      class: options.class,
      direction: options.direction,
      gap: options.gap,
      align: undefined,
      justify: undefined,
      padding: undefined,
      when: options.when,
      at: options.at,
      dryRun: options.dryRun ?? false,
    },
  });
  return { root, result };
}

describe('parseCss', () => {
  it('reads declarations, the rule braces, comments and state blocks', () => {
    expect(parseCss('/* button */ { display: inline-flex; gap: 9px; &:hover { opacity: 0.8; } :disabled { opacity: 0.4 } }')).toEqual({
      base: [
        ['display', 'inline-flex'],
        ['gap', '9px'],
      ],
      states: { hover: [['opacity', '0.8']], disabled: [['opacity', '0.4']] },
    });
    expect(parseCss('background: url("a;b.png")').base).toEqual([['background', 'url("a;b.png")']]);
  });

  it.each([
    ['.btn { color: red }', 'is not a supported state'],
    ['&:hover { & span { color: red } }', 'Only declarations and state blocks'],
    ['color red', 'is not a CSS declaration'],
    ['&:hover { color: red', 'is not closed'],
    ['  ', 'No CSS declaration given'],
  ])('refuses %j', (text, message) => {
    expect(() => parseCss(text)).toThrow(message);
  });
});

describe('parseStyleObject', () => {
  it("reads a React style object: camelCase, px numbers, unitless numbers and states", () => {
    expect(parseStyleObject("{ display: 'inline-flex', paddingInline: 14, fontWeight: 650, margin: 0, '--accent': 2, '&:hover': { opacity: 0.8 } }")).toEqual({
      base: [
        ['display', 'inline-flex'],
        ['padding-inline', '14px'],
        ['font-weight', '650'],
        ['margin', '0'],
        ['--accent', '2'],
      ],
      states: { hover: [['opacity', '0.8']] },
    });
    expect(parseStyleObject('{ WebkitTransition: "none", marginTop: -4 }').base).toEqual([
      ['-webkit-transition', 'none'],
      ['margin-top', '-4px'],
    ]);
  });

  it.each([
    ['[1, 2]', 'is not an object'],
    ['{ color: theme.ink }', 'must be a string or a number'],
    ["{ '&:focus': { color: 'red' } }", 'is not a supported state'],
    ['{}', 'is empty'],
  ])('refuses %s', (text, message) => {
    expect(() => parseStyleObject(text)).toThrow(message);
  });
});

describe('style update: tokens', () => {
  const tokens = {
    'src/app/styles/tokens/colors.json': JSON.stringify({ primary: '#2563eb' }),
    'src/app/styles/tokens/typography.json': JSON.stringify({ size: { base: '1rem' } }),
  };

  it('refuses colors and fonts that are not tokens, and takes those that are and raw values', async () => {
    const color = await update(`${id}#root`, { css: 'color: var(--color-brand)' }, tokens);
    expect(color.result.issues?.map((issue) => `${issue.code} ${issue.message}`)).toEqual(['color-unknown --color-brand is not in tokens/colors.json.']);
    const font = await update(`${id}#root`, { css: 'font-size: var(--text-huge)' }, tokens);
    expect(font.result.issues?.map((issue) => issue.code)).toEqual(['font-unknown']);
    const known = await update(`${id}#root`, { css: 'color: var(--color-primary); font-size: var(--text-base); border-color: #e5e7eb' }, tokens);
    expect(known.result.issues).toEqual([]);
  });
});

describe('style update: CSS Modules', () => {
  it('merges declarations into the element style, property by property', async () => {
    const { root, result } = await update(`${id}#header`, { css: 'display: inline-flex; gap: 9px; color: var(--color-text)', gap: '4' });
    expect(result.summary).toBe(`Updated the style "root" in ${css}.`);
    expect(await read(root, css)).toBe(lines('.root {', '  display: inline-flex;', '  gap: 9px;', '  height: 3.5rem;', '  color: var(--color-text);', '}'));
  });

  it('puts the display of a dialog in its open state, once', async () => {
    const dialog = { [file]: TOP_BAR.replace('<header className={styles.root}>', '<dialog className={styles.root}>').replace('</header>', '</dialog>'), [css]: lines('.root {', '  height: 3.5rem;', '}') };
    const expected = lines('.root {', '  height: 3.5rem;', '  gap: var(--space-4);', '}', '', '.root[open] {', '  display: flex;', '}');
    const { root } = await update(`${id}#root`, { gap: '4' }, dialog);
    expect(await read(root, css)).toBe(expected);
    const again = await update(`${id}#root`, { gap: '4' }, { ...dialog, [css]: expected });
    expect(await read(again.root, css)).toBe(expected);
  });

  it('writes states as their own rules, right after the element base rule', async () => {
    const tree = { [css]: `${TOP_BAR_CSS}\n.other {\n  color: red;\n}\n` };
    const { root } = await update(`${id}#header`, { css: 'opacity: 0.9; &:focus-visible { outline: 2px solid }', state: 'hover' }, tree);
    expect(await read(root, css)).toBe(
      lines(
        '.root {',
        '  display: flex;',
        '  gap: var(--space-2);',
        '  height: 3.5rem;',
        '}',
        '',
        '.root:focus-visible {',
        '  outline: 2px solid;',
        '}',
        '',
        '.root:hover:not(:disabled) {',
        '  opacity: 0.9;',
        '}',
        '',
        '.other {',
        '  color: red;',
        '}',
      ),
    );
  });

  it('gives an element a style with --name, from a style object read from a file', async () => {
    const { root, result } = await update(`${id}#header/a`, { name: 'link', objectFile: 'design/link.js' }, { 'design/link.js': "{ color: 'inherit', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }\n" });
    expect(result.actions?.map((action) => `${action.type} ${action.path} ${action.message}`)).toEqual([
      `update ${css} style "link"`,
      `update ${file} gave <a> the style "link"`,
    ]);
    expect(await read(root, file)).toContain('<a className={styles.link} href="/docs">Docs</a>');
    expect(await read(root, css)).toContain('.link {\n  color: inherit;\n  text-decoration: none;\n}\n\n.link:hover:not(:disabled) {\n  text-decoration: underline;\n}\n');
    expect(await issuesOfUsedCode(root)).toEqual([]);
  });

  it('creates the style file and its import for a file without them', async () => {
    const plain = { [file]: 'export const TopBar: React.FC = () => <header><a href="/">Home</a></header>;\n', [css]: '' };
    const { root } = await update(`${id}#header/a`, { name: 'link', css: 'color: inherit' }, plain);
    expect(await read(root, file)).toBe("import styles from './TopBar.module.css';\n\nexport const TopBar: React.FC = () => <header><a className={styles.link} href=\"/\">Home</a></header>;\n");
    expect(await read(root, css)).toBe('.link {\n  color: inherit;\n}\n');
  });

  it.each([
    [`${id}#header/a`, { css: 'color: red' }, 'style-name-required'],
    [`${id}#header`, { name: 'bar', css: 'color: red' }, 'style-name-conflict'],
    [`${id}#header/span`, { css: 'color: red' }, 'style-classname-unsupported'],
    [`${id}#header`, { class: 'flex gap-2' }, 'style-class-not-tailwind'],
    [`${id}#header`, { css: 'color: red', object: '{}' }, 'options-conflict'],
    [`${id}#header`, { gap: '2', state: 'hover' }, 'options-conflict'],
    [`${id}#header`, {}, 'style-nothing'],
    [`${id}#header`, { cssFile: 'nope.css' }, 'style-file-missing'],
  ])('refuses %s %j', async (target, options, code) => {
    expect((await update(target, options as Options)).result.issues?.map((issue) => issue.code)).toEqual([code]);
  });

  it('writes nothing with --dry-run', async () => {
    const { root } = await update(`${id}#header`, { css: 'color: red', dryRun: true });
    expect(await read(root, css)).toBe(TOP_BAR_CSS);
  });
});

describe('style update: Tailwind', () => {
  const tailwind = { [file]: TOP_BAR.replace("import styles from './TopBar.module.css';", "import { styles } from './TopBar.styles';"), [`${dir}/TopBar.styles.ts`]: "export const styles = {\n  root: 'flex gap-2 h-14',\n};\n" };
  const stylesFile = `${dir}/TopBar.styles.ts`;

  it('replaces the classes with --class, states included', async () => {
    const { root } = await update(`${id}#header`, { class: 'inline-flex items-center gap-1.5 hover:underline' }, tailwind, { styles: 'tailwind' });
    expect(await read(root, stylesFile)).toBe("export const styles = {\n  root: 'inline-flex items-center gap-1.5 hover:underline',\n};\n");
  });

  it('merges CSS as arbitrary properties, with state prefixes, and adds new styles', async () => {
    const merged = await update(`${id}#header`, { css: 'gap: 9px; &:hover { opacity: 0.8 }' }, tailwind, { styles: 'tailwind' });
    expect(await read(merged.root, stylesFile)).toBe("export const styles = {\n  root: 'flex h-14 [gap:9px] not-disabled:hover:[opacity:0.8]',\n};\n");

    const added = await update(`${id}#header/a`, { name: 'link', class: 'text-inherit hover:underline' }, tailwind, { styles: 'tailwind' });
    expect(await read(added.root, stylesFile)).toBe("export const styles = {\n  root: 'flex gap-2 h-14',\n  link: 'text-inherit hover:underline',\n};\n");
    expect(await read(added.root, file)).toContain('<a className={styles.link} href="/docs">');
  });
});

describe('style update: the current state', () => {
  it('styles the link of the current page, which router links mark with aria-current', async () => {
    const plain = await update(`${id}#header/a`, { name: 'link', state: 'current', css: 'color: var(--color-primary)' });
    expect(await read(plain.root, css)).toContain('.link[aria-current="page"] {\n  color: var(--color-primary);\n}\n');

    const nested = await update(`${id}#header`, { css: '&[aria-current="page"] { font-weight: 600 }' });
    expect(await read(nested.root, css)).toContain('.root[aria-current="page"] {\n  font-weight: 600;\n}\n');

    const tailwind = {
      [file]: TOP_BAR.replace("import styles from './TopBar.module.css';", "import { styles } from './TopBar.styles';"),
      [`${dir}/TopBar.styles.ts`]: "export const styles = {\n  root: 'flex',\n};\n",
    };
    const classes = await update(`${id}#header`, { state: 'current', css: 'font-weight: 600' }, tailwind, { styles: 'tailwind' });
    expect(await read(classes.root, `${dir}/TopBar.styles.ts`)).toContain("root: 'flex aria-[current=page]:[font-weight:600]'");
  });
});

describe('style update: the ARIA states', () => {
  it('styles a pressed toggle, a selected tab and an expanded menu button by their aria attributes', async () => {
    const pressed = await update(`${id}#header`, { state: 'pressed', css: 'outline: 2px solid' });
    expect(await read(pressed.root, css)).toContain('.root[aria-pressed="true"] {\n  outline: 2px solid;\n}\n');

    const nested = await update(`${id}#header`, { css: '&[aria-selected="true"] { font-weight: 600 } &[aria-expanded=\'true\'] { color: red }' });
    const text = await read(nested.root, css);
    expect(text).toContain('.root[aria-selected="true"] {\n  font-weight: 600;\n}\n');
    expect(text).toContain('.root[aria-expanded="true"] {\n  color: red;\n}\n');

    const tailwind = {
      [file]: TOP_BAR.replace("import styles from './TopBar.module.css';", "import { styles } from './TopBar.styles';"),
      [`${dir}/TopBar.styles.ts`]: "export const styles = {\n  root: 'flex',\n};\n",
    };
    const classes = await update(`${id}#header`, { state: 'pressed', css: 'font-weight: 600' }, tailwind, { styles: 'tailwind' });
    expect(await read(classes.root, `${dir}/TopBar.styles.ts`)).toContain("root: 'flex aria-pressed:[font-weight:600]'");
  });
});
