import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { componentNames, destructureProps, resolveNames } from '../../src/shared/values/scope.js';
import { jsxAttribute, jsxText, parseValue, rootNames } from '../../src/shared/values/template.js';

describe('parseValue', () => {
  it('splits text and variables', () => {
    const parts = parseValue('Hello, { user.name }! Bye {label}');
    expect(parts).toEqual([
      { kind: 'text', text: 'Hello, ' },
      { kind: 'name', path: 'user.name', root: 'user' },
      { kind: 'text', text: '! Bye ' },
      { kind: 'name', path: 'label', root: 'label' },
    ]);
    expect(rootNames([...parts, ...parseValue('{user.id}')])).toEqual(['user', 'label']);
  });

  it('keeps escaped braces as text', () => {
    expect(parseValue('a \\{b\\} c')).toEqual([{ kind: 'text', text: 'a {b} c' }]);
  });

  it.each(['{a + b}', '{format(x)}', '{a ? b : c}', '{user?.name}', '{}', '{items[0]}'])('refuses %s', (value) => {
    expect(() => parseValue(value)).toThrow(/only names and property paths/);
  });
});

describe('jsxText and jsxAttribute', () => {
  it('writes text and variables as JSX', () => {
    expect(jsxText(parseValue('Hello, {user.name}!'))).toBe('Hello, {user.name}!');
    expect(jsxText(parseValue('a < b'))).toBe('{"a < b"}');
  });

  it('writes a string, a variable, or a template literal', () => {
    expect(jsxAttribute('href', parseValue('/docs'))).toBe('href="/docs"');
    expect(jsxAttribute('href', parseValue('say "hi"'))).toBe('href={"say \\"hi\\""}');
    expect(jsxAttribute('href', parseValue('{link.href}'))).toBe('href={link.href}');
    expect(jsxAttribute('href', parseValue('/docs/{slug}#`x`'))).toBe('href={`/docs/${slug}#\\`x\\``}');
  });
});

const parse = (text: string) => ts.createSourceFile('NavMenu.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

describe('componentNames and resolveNames', () => {
  const file = [
    "import { useState } from 'react';",
    "import type { Item } from './types';",
    'const TITLE = "Docs";',
    'export interface NavMenuProps { label: string; items: Item[] }',
    'export const NavMenu: React.FC<NavMenuProps> = ({ items: list }) => {',
    '  const [open, setOpen] = useState(false);',
    '  return <button />;',
    '};',
  ].join('\n');
  const names = componentNames(parse(file), 'NavMenu')!;
  const where = { file: 'NavMenu.tsx', component: 'NavMenu' };

  it('finds props, parameters, constants and imports, but not type imports', () => {
    expect([...names.props]).toEqual(['label', 'items']);
    // Top-level constants of a component file don't count: constants live in constants.ts.
    expect([...names.inScope].sort()).toEqual(['list', 'open', 'setOpen', 'useState']);
  });

  it('returns the props to destructure and the constants to import, and refuses unknown names', () => {
    const constants = new Map([['TITLE', '../../constants']]);
    expect(resolveNames(names, ['TITLE', 'open', 'label'], { ...where, constants })).toEqual({ props: ['label'], imports: constants, placeholders: new Map() });
    expect(() => resolveNames(names, ['TITLE'], where)).toThrow('"TITLE" is not a prop of NavMenu');
    expect(() => resolveNames(names, ['Item'], where)).toThrow('"Item" is not a prop of NavMenu');
    expect(() => resolveNames(names, ['items'], where)).toThrow('The prop "items" of NavMenu is destructured as "list".');
  });

  it('uses the props parameter when the props are not destructured', () => {
    const plain = componentNames(parse('export const NavMenu: React.FC<NavMenuProps> = (props) => <b />;\ninterface NavMenuProps { label: string }'), 'NavMenu')!;
    expect(() => resolveNames(plain, ['label'], where)).toThrow('which takes its props as "props"');
    expect(resolveNames(plain, ['props'], where)).toEqual({ props: [], imports: new Map(), placeholders: new Map() });
  });
});

describe('destructureProps', () => {
  const component = (parameter: string) => `export const NavMenu: React.FC<P> = ${parameter} => <b />;\n`;
  it.each([
    ['()', '({ label })'],
    ['({ a })', '({ a, label })'],
    ['({})', '({ label })'],
    ['({ a, ...rest })', '({ a, label, ...rest })'],
  ])('%s → %s', (before, after) => {
    expect(destructureProps(component(before), 'NavMenu.tsx', 'NavMenu', ['label'])).toBe(component(after));
  });
});
