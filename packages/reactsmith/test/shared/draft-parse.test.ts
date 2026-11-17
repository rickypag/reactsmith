import { describe, expect, it } from 'vitest';
import { cleanJsxText, parseDraft, type DraftElement } from '../../src/shared/components/draft/parse.js';

const lines = (...text: string[]) => text.join('\n');

const root = (draft: string): DraftElement => {
  const parsed = parseDraft(draft);
  expect(parsed.problems).toEqual([]);
  return parsed.root!;
};

const codesAndLines = (draft: string) => parseDraft(draft).problems.map((problem) => [problem.code, problem.line]);

describe('parseDraft', () => {
  it('reads tags, props, $ attributes and text', () => {
    const card = root(
      lines(
        '<article $direction="column" $gap="3" $css="border-radius: var(--radius-lg)" $css-hover="opacity: 0.8">',
        '  <img $name="photo" src={image} alt={title} />',
        '  <p $name="greeting">Hello, {user.name}!</p>',
        '</article>',
      ),
    );
    expect(card).toMatchObject({ tag: 'article', line: 1, layout: { direction: 'column', gap: '3' } });
    expect(card.styles).toEqual([
      { line: 1, attribute: '$css', css: 'border-radius: var(--radius-lg)' },
      { line: 1, attribute: '$css-hover', css: 'opacity: 0.8', state: 'hover' },
    ]);
    const [photo, greeting] = card.children as DraftElement[];
    expect(photo).toMatchObject({ tag: 'img', name: 'photo', props: 'src={image} alt={title}', line: 2 });
    expect(greeting).toMatchObject({ tag: 'p', name: 'greeting', text: 'Hello, {user.name}!', line: 3 });
  });

  it('reads breakpoints and prop conditions from $css- attributes', () => {
    const element = root('<div $css-at-mobile="gap: 0" $css-when-selected="color: red" $css-when-status-Error="color: red" $css-focus-visible="outline: none" />');
    expect(element.styles.map(({ at, when, state }) => ({ at, when, state }))).toEqual([
      { at: 'mobile', when: undefined, state: undefined },
      { at: undefined, when: 'selected', state: undefined },
      { at: undefined, when: 'status=Error', state: undefined },
      { at: undefined, when: undefined, state: 'focus-visible' },
    ]);
  });

  it('keeps elements written before the text apart, so they are inserted first', () => {
    const button = root('<button><SearchIcon size={16} />Search</button>');
    expect(button.text).toBe('Search');
    expect(button.before.map((child) => (child as DraftElement).tag)).toEqual(['SearchIcon']);
    expect(button.children).toEqual([]);
  });

  it('reads lists, conditions, fallbacks and both branches', () => {
    const element = root(
      lines(
        '<div>',
        '  {links.map((link) => <NavLink key={link.href} {...link} />)}',
        '  {open && <nav $name="menu" />}',
        '  {open ? null : <p>Open</p>}',
        '  {label ?? <span>None</span>}',
        '  {loading ? <p>Loading</p> : <ul />}',
        '  {/* a comment */}',
        '</div>',
      ),
    );
    expect(element.children).toMatchObject([
      { tag: 'NavLink', props: '{...link}', list: { each: 'links', as: 'link', key: 'link.href' } },
      { tag: 'nav', if: 'open' },
      { tag: 'p', if: '!open' },
      { tag: 'span', fallback: 'label' },
      { kind: 'ternary', test: 'loading', whenTrue: { tag: 'p' }, whenFalse: { tag: 'ul' } },
    ]);
  });

  it('reads a message as the only text of an element', () => {
    expect(root("<span>{t('register')}</span>")).toMatchObject({ message: 'register' });
  });

  it('reports every problem at once, with its line', () => {
    expect(
      codesAndLines(
        lines(
          '<div className="x">',
          '  <p onClick={() => go()}>{a + b}</p>',
          '  <span $colour="red">x</span>',
          '  {open || <p>no</p>}',
          '  <b>a<i />b</b>',
          '  <Item key={id} />',
          '</div>',
        ),
      ),
    ).toEqual([
      ['draft-attribute-invalid', 1],
      ['draft-expression-invalid', 2],
      ['draft-expression-invalid', 2],
      ['draft-style-attribute-unknown', 3],
      ['draft-condition-invalid', 4],
      ['draft-text-split', 5],
      ['draft-key-outside-list', 6],
    ]);
  });

  it('refuses a root that is a fragment, a list, a condition or named, and code that is not JSX', () => {
    expect(codesAndLines('<><p /></>')).toEqual([['draft-root-invalid', 1]]);
    expect(codesAndLines('<div $name="card" />')).toEqual([['draft-root-name', 1]]);
    expect(codesAndLines('const x = 1;')[0]?.[0]).toBe('draft-syntax');
    expect(codesAndLines('<div>')[0]?.[0]).toBe('draft-syntax');
  });

  it('refuses lists that are not one component with a key', () => {
    expect(codesAndLines('<ul>{items.map((item) => <Item />)}</ul>')).toEqual([['draft-list-invalid', 1]]);
    expect(codesAndLines('<ul>{items.map((item, index) => <Item key={index} />)}</ul>')).toEqual([['draft-list-invalid', 1]]);
    expect(codesAndLines('<ul>{items.map((item) => <Item key={item.id}><b /></Item>)}</ul>')).toEqual([['draft-list-invalid', 1]]);
  });
});

describe('cleanJsxText', () => {
  it('follows JSX: lines trimmed and joined by a space, blank lines dropped', () => {
    expect(cleanJsxText('\n    Hello\n    world  \n  ')).toBe('Hello world');
    expect(cleanJsxText(' Hi ')).toBe(' Hi ');
    expect(cleanJsxText('\n   \n')).toBe('');
  });
});
