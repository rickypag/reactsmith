import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { componentCreateCommand } from '../../src/commands/component/create/command.js';
import { createProject, exists, read } from '../helpers.js';

const DOCS = { 'src/features/docs/index.ts': '', 'src/main.tsx': "import '@/features/docs'" };
const dir = 'src/features/docs/components';
const lines = (...text: string[]) => text.join('\n');

interface Options {
  interface?: string;
  root?: string;
  dryRun?: boolean;
  /** Without stdin, as in a batch line. */
  noStdin?: boolean;
  replace?: boolean;
  /** With --replace: leave out --feature, so the component is found by its name. */
  byName?: boolean;
}

function create(root: string, name: string, draft: string, options: Options = {}) {
  return componentCreateCommand.run({
    cwd: root,
    args: { name },
    options: {
      feature: options.byName ? undefined : 'docs',
      app: false,
      type: undefined,
      interface: options.interface,
      rootProps: undefined,
      from: undefined,
      direction: undefined,
      gap: undefined,
      align: undefined,
      justify: undefined,
      padding: undefined,
      root: options.root,
      text: undefined,
      jsx: '-',
      replace: options.replace ?? false,
      dryRun: options.dryRun ?? false,
    },
    readStdin: options.noStdin ? undefined : async () => draft,
  });
}

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);

describe('component create --jsx', () => {
  it('creates a whole component from its draft, styles included', async () => {
    const root = await createProject(DOCS);
    const result = await create(
      root,
      'OfferCard',
      lines(
        '<article $direction="column" $gap="3" $css="border-radius: 8px" $css-hover="opacity: 0.8">',
        '  <img $name="photo" src={image} alt={title} />',
        '  <h3 $name="title">{title}</h3>',
        '  <div $name="footer" $direction="row" $justify="between">',
        '    <span $name="price" $css="font-weight: 700">{price}</span>',
        '    {onSale && <span $name="sale">On sale</span>}',
        '  </div>',
        '</article>',
      ),
      { interface: 'image: string; title: string; price: string; onSale?: boolean' },
    );
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.actions?.map((action) => action.path)).toEqual([`${dir}/OfferCard/OfferCard.tsx`, `${dir}/OfferCard/OfferCard.module.css`, `${dir}/OfferCard/index.ts`]);
    const component = await read(root, `${dir}/OfferCard/OfferCard.tsx`);
    expect(component).toContain(
      lines(
        '    <article className={styles.root}>',
        '      <img className={styles.photo} src={image} alt={title} />',
        '      <h3 className={styles.title}>{title}</h3>',
        '      <div className={styles.footer}>',
        '        <span className={styles.price}>{price}</span>',
        '        {onSale && <span className={styles.sale}>On sale</span>}',
        '      </div>',
        '    </article>',
      ),
    );
    const css = await read(root, `${dir}/OfferCard/OfferCard.module.css`);
    expect(css).toContain('  border-radius: 8px;');
    expect(css).toContain('.root:hover');
    expect(css).toContain('.footer {\n  display: flex;\n  flex-direction: row;\n  justify-content: space-between;\n}');
    expect(css).toContain('.price {\n  font-weight: 700;\n}');
    expect(result.summary).toContain('span #price "{price}"');
  });

  it('keeps the order of the draft: elements before the text, both branches, and lists', async () => {
    const root = await createProject(DOCS);
    expect((await create(root, 'Badge', '<span>{label}</span>', { interface: 'label: string' })).ok).toBe(true);
    const result = await create(
      root,
      'Offers',
      lines(
        '<section>',
        '  <button type="button"><Badge label="New" />See all</button>',
        '  {loading ? <p>Loading</p> : <ul $name="list">{offers.map((offer) => <Badge key={offer.id} label={offer.label} />)}</ul>}',
        '</section>',
      ),
      { interface: 'loading: boolean; offers: { id: string; label: string }[]' },
    );
    expect(result.issues).toEqual([]);
    const component = await read(root, `${dir}/Offers/Offers.tsx`);
    expect(component).toContain('<button type="button"><Badge label="New" />See all</button>');
    expect(component).toContain('{loading ? <p>Loading</p> : <ul className={styles.list}>');
    expect(component).toContain('{offers.map((offer) => <Badge key={offer.id} label={offer.label} />)}');
  });

  it('writes nothing when a step refuses, and says the line of the draft', async () => {
    const root = await createProject(DOCS);
    const result = await create(root, 'Card', lines('<div>', '  <h3 $name="title">Hi</h3>', '  <p $name="sub">{subtitle}</p>', '</div>'));
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['value-name-unknown']);
    expect(result.issues?.[0]?.message).toMatch(/^Line 3: /);
    expect(await exists(root, `${dir}/Card`)).toBe(false);
    expect(await exists(root, `${dir}`)).toBe(false);
  });

  it('refuses what an element cannot hold, as element insert does', async () => {
    const root = await createProject(DOCS);
    const result = await create(root, 'Card', lines('<div>', '  <section $name="body">loose text</section>', '</div>'));
    expect(codes(result)).toEqual(['element-text-not-allowed']);
    expect(await exists(root, `${dir}/Card`)).toBe(false);
  });

  it('reports every problem of the draft before anything runs', async () => {
    const root = await createProject(DOCS);
    const result = await create(root, 'Card', lines('<div className="x">', '  <p style={{ color: "red" }}>{a + b}</p>', '</div>'));
    expect(codes(result)).toEqual(['draft-attribute-invalid', 'draft-attribute-invalid', 'draft-expression-invalid']);
    expect(result.issues?.map((issue) => issue.path)).toEqual(['draft:1', 'draft:2', 'draft:2']);
    expect(await exists(root, `${dir}/Card`)).toBe(false);
  });

  it('changes nothing with --dry-run, but says what it would create', async () => {
    const root = await createProject(DOCS);
    const result = await create(root, 'Card', lines('<div $gap="2">', '  <p $name="text">Hi</p>', '</div>'), { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.summary).toContain('p #text "Hi"');
    expect(await exists(root, `${dir}/Card`)).toBe(false);
  });

  it('refuses the options the root of the draft replaces, and a missing stdin', async () => {
    const root = await createProject(DOCS);
    expect(codes(await create(root, 'Card', '<div />', { root: 'nav' }))).toEqual(['options-conflict']);
    expect(codes(await create(root, 'Card', '<div />', { noStdin: true }))).toEqual(['draft-stdin-unavailable']);
  });
});

describe('component create --jsx: CSS order', () => {
  it('keeps every base rule before the breakpoints\' @media blocks, so the overrides win', async () => {
    const root = await createProject(DOCS);
    const result = await create(
      root,
      'EngineList',
      lines('<section $direction="row" $css-at-mobile="flex-direction: column">', '  <div $name="list" $direction="row" $gap="2">', '    <p $name="title">Engines</p>', '  </div>', '</section>'),
    );
    expect(result.issues).toEqual([]);
    const css = await read(root, `${dir}/EngineList/EngineList.module.css`);
    const media = css.indexOf('@media');
    expect(media).toBeGreaterThan(-1);
    for (const rule of ['.root {', '.list {', '.title {']) {
      expect(css.indexOf(rule)).toBeGreaterThan(-1);
      expect(css.indexOf(rule)).toBeLessThan(media);
    }
  });
});

describe('component create --jsx: ARIA states', () => {
  it('styles a toggle by aria-pressed with $css-pressed', async () => {
    const root = await createProject(DOCS);
    const result = await create(root, 'ThemeToggle', '<button type="button" aria-pressed={dark} $css-pressed="background: black">Dark</button>', { interface: 'dark: boolean' });
    expect(result.issues).toEqual([]);
    expect(await read(root, `${dir}/ThemeToggle/ThemeToggle.module.css`)).toContain('.root[aria-pressed="true"] {\n  background: black;\n}');
  });
});

describe('component create --jsx --replace', () => {
  /** A Card that shows a Badge, with logic written by hand before its return. */
  async function cardProject() {
    const root = await createProject(DOCS);
    expect((await create(root, 'Badge', '<span>{label}</span>', { interface: 'label: string' })).ok).toBe(true);
    const created = await create(
      root,
      'Card',
      lines('<article $gap="2">', '  <h3 $name="title">{title}</h3>', '  <p $name="subtitle">{subtitle}</p>', '  <Badge label="New" />', '</article>'),
      { interface: 'title: string; subtitle: string' },
    );
    expect(created.issues).toEqual([]);
    const file = `${dir}/Card/Card.tsx`;
    const text = await read(root, file);
    await writeFile(path.join(root, file), text.replace('  return (', '  const upper = title.toUpperCase();\n\n  return ('));
    return { root, file };
  }

  it('replaces the JSX and the styles, keeping the props and the code before the return', async () => {
    const { root, file } = await cardProject();
    const result = await create(root, 'Card', lines('<section $direction="row">', '  <h2 $name="heading">{upper}</h2>', '</section>'), { replace: true });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    const text = await read(root, file);
    expect(text).toContain('export interface CardProps {\n  title: string;\n  subtitle: string;\n}');
    expect(text).toContain('const upper = title.toUpperCase();');
    expect(text).toContain('<section className={styles.root}>\n      <h2 className={styles.heading}>{upper}</h2>\n    </section>');
    // Badge and subtitle were only used by the old JSX.
    expect(text).not.toContain('Badge');
    expect(text).toContain('= ({ title }) =>');
    const css = await read(root, `${dir}/Card/Card.module.css`);
    expect(css).toContain('.root {\n  display: flex;\n  flex-direction: row;\n}');
    expect(css).toContain('.heading {');
    expect(css).not.toContain('.title');
    expect(result.summary).toContain('Replaced the JSX of');
  });

  it('keeps the rules written by hand whose elements are still there, and says which went', async () => {
    const { root } = await cardProject();
    const cssFile = `${dir}/Card/Card.module.css`;
    const handRules = '\n.root[aria-pressed="true"] {\n  outline: 2px solid;\n}\n\n.root:hover .title {\n  color: red;\n}\n\n.subtitle::first-line {\n  font-weight: 700;\n}\n';
    await writeFile(path.join(root, cssFile), `${await read(root, cssFile)}${handRules}`);
    const result = await create(root, 'Card', lines('<article>', '  <h3 $name="title" $css="margin: 0">{title}</h3>', '</article>'), { replace: true });
    expect(result.ok).toBe(true);
    const css = await read(root, cssFile);
    expect(css).toContain('.root[aria-pressed="true"] {\n  outline: 2px solid;\n}');
    expect(css).toContain('.root:hover .title {\n  color: red;\n}');
    // Its element is gone, and the element's own styles are the draft's.
    expect(css).not.toContain('first-line');
    expect(css).not.toContain('.subtitle');
    expect(css.match(/^\.title \{/gm)).toHaveLength(1);
    expect(result.issues?.map((issue) => [issue.code, issue.message])).toEqual([
      ['replace-rules-kept', 'Line 1: Kept the rules written by hand: .root[aria-pressed="true"], .root:hover .title.'],
      ['replace-rules-dropped', "Line 1: Dropped the rules written by hand for elements the new JSX doesn't have: .subtitle::first-line."],
    ]);
  });

  it('finds the component by its name', async () => {
    const { root, file } = await cardProject();
    const result = await create(root, 'Card', '<div><p $name="text">{title}</p></div>', { replace: true, byName: true });
    expect(result.issues).toEqual([]);
    expect(await read(root, file)).toContain('<p className={styles.text}>{title}</p>');
  });

  it('puts every file back when a step refuses', async () => {
    const { root, file } = await cardProject();
    const tsx = await read(root, file);
    const css = await read(root, `${dir}/Card/Card.module.css`);
    const result = await create(root, 'Card', lines('<div>', '  <p $name="text">{missing}</p>', '</div>'), { replace: true });
    expect(codes(result)).toEqual(['value-name-unknown']);
    expect(await read(root, file)).toBe(tsx);
    expect(await read(root, `${dir}/Card/Card.module.css`)).toBe(css);
  });

  it('refuses a component with several returns, one that does not exist, and --interface', async () => {
    const { root, file } = await cardProject();
    const text = await read(root, file);
    await writeFile(path.join(root, file), text.replace('  const upper', '  if (!title) return null;\n  const upper'));
    expect(codes(await create(root, 'Card', '<div />', { replace: true }))).toEqual(['replace-return-ambiguous']);
    expect(codes(await create(root, 'Nope', '<div />', { replace: true, byName: true }))).toEqual(['component-missing']);
    expect(codes(await create(root, 'Card', '<div />', { replace: true, interface: 'a: string' }))).toEqual(['options-conflict']);
  });
});

describe('{children} in a draft', () => {
  it('renders children in the root, in the order of the draft', async () => {
    const root = await createProject(DOCS);
    const result = await create(root, 'Panel', lines('<section>', '  <h2 $name="heading">{title}</h2>', '  {children}', '  <footer $name="footer" />', '</section>'), {
      interface: 'title: string; children: React.ReactNode',
    });
    expect(result.issues).toEqual([]);
    const text = await read(root, `${dir}/Panel/Panel.tsx`);
    expect(text.indexOf('styles.heading')).toBeLessThan(text.indexOf('{children}'));
    expect(text.indexOf('{children}')).toBeLessThan(text.indexOf('styles.footer'));
  });

  it('needs the children prop', async () => {
    const root = await createProject(DOCS);
    expect(codes(await create(root, 'Panel', '<section>{children}</section>'))).toEqual(['draft-children-undeclared']);
  });
});

describe('component create --jsx --replace on a styleable component', () => {
  it('keeps merging the class its parent passes', async () => {
    const root = await createProject(DOCS);
    expect((await create(root, 'Badge', '<span>{label}</span>', { interface: 'label: string' })).ok).toBe(true);
    // Styling Badge from its parent makes it styleable.
    expect((await create(root, 'Card', '<div><Badge $name="badge" label="New" /></div>')).issues).toEqual([]);
    expect(await read(root, `${dir}/Badge/Badge.tsx`)).toContain('className={cx(styles.root, className)}');
    const result = await create(root, 'Badge', '<strong>{label}</strong>', { replace: true });
    expect(result.issues).toEqual([]);
    expect(await read(root, `${dir}/Badge/Badge.tsx`)).toContain('<strong className={cx(styles.root, className)}>{label}</strong>');
  });
});
