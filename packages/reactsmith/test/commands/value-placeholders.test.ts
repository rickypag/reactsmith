import { describe, expect, it } from 'vitest';
import { componentCreateCommand } from '../../src/commands/component/create/command.js';
import { componentUpdateCommand } from '../../src/commands/component/update/command.js';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { elementUpdateCommand } from '../../src/commands/element/update/command.js';
import { placeholderDeclaration } from '../../src/shared/values/placeholders.js';
import { createProject, read } from '../helpers.js';

// Every command that gives a variable to a prop resolves it the same way: a variable of the file, a prop of the
// component (destructured), a placeholder when the prop's type is basic, or a refusal.

const lines = (...text: string[]) => `${text.join('\n')}\n`;
const components = 'src/features/docs/components';
const group = `${components}/FilterGroup`;
const card = `${components}/FiltersCard`;
const cardFile = `${card}/FiltersCard.tsx`;
const cardId = 'features/docs/components/FiltersCard/FiltersCard.tsx';

const filterGroup = (props: string[]) => ({
  [`${group}/FilterGroup.tsx`]: lines(
    "import type { Filters } from '../../types';",
    '',
    'export interface FilterGroupProps {',
    ...props.map((prop) => `  ${prop};`),
    '}',
    '',
    'export const FilterGroup: React.FC<FilterGroupProps> = () => {',
    '  return <div />;',
    '};',
  ),
  [`${group}/index.ts`]: "export { FilterGroup } from './FilterGroup';\nexport type { FilterGroupProps } from './FilterGroup';\n",
});

const PROPS = ['label?: string', 'count?: number', 'open?: boolean', "size?: 'sm' | 'lg'", 'tags?: string[]', 'choices?: Choice[]', 'filters?: Filters', 'onChange?: () => void'];

const TREE = {
  'src/features/docs/index.ts': '',
  'src/features/docs/types/index.ts': 'export interface Filters {\n  category: string;\n}\nexport interface Choice {\n  id: string;\n}\n',
  ...filterGroup(PROPS),
  [cardFile]: lines(
    "import { FilterGroup } from '../FilterGroup';",
    '',
    'export interface FiltersCardProps {',
    '  filters: Filters;',
    '}',
    '',
    'export const FiltersCard: React.FC<FiltersCardProps> = () => {',
    '  return (',
    '    <div>',
    '      <FilterGroup />',
    '    </div>',
    '  );',
    '};',
  ),
  [`${card}/index.ts`]: "export { FiltersCard } from './FiltersCard';\n",
};

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);

async function insert(props: string, tree: Record<string, string> = TREE) {
  const root = await createProject(tree, { appFiles: 'root' });
  const result = await elementInsertCommand.run({
    cwd: root,
    args: { name: 'FilterGroup' },
    options: { around: undefined, through: undefined, if: undefined, fallback: undefined, into: `${cardId}#div`, position: undefined, from: undefined, props, text: undefined, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
  });
  return { root, result, text: await read(root, cardFile) };
}

describe('placeholder values', () => {
  it.each([
    ['string', "const x = ''; // placeholder: give it its real value"],
    ['number', 'const x = 0; // placeholder: give it its real value'],
    ['boolean', 'const x = false; // placeholder: give it its real value'],
    ['string | undefined', "const x = ''; // placeholder: give it its real value"],
    ["'sm' | 'lg'", "const x = 'sm'; // placeholder: give it its real value"],
    ['string[]', 'const x: string[] = []; // placeholder: give it its real value'],
    ['Array<number>', 'const x: Array<number> = []; // placeholder: give it its real value'],
    ['Choice[]', "const x: React.ComponentProps<typeof Group>['items'] = []; // placeholder: give it its real value"],
  ])('declares a %s', (type, declaration) => {
    expect(placeholderDeclaration('x', { component: 'Group', prop: 'items', type })).toBe(declaration);
  });

  it.each(['Filters', '() => void', '{ a: string }', 'React.ReactNode', 'string | Filters'])('makes none for %s', (type) => {
    expect(placeholderDeclaration('x', { component: 'Group', prop: 'items', type })).toBeUndefined();
  });
});

describe('element insert: variables given to props', () => {
  it('destructures a prop of the component that holds the element', async () => {
    const { result, text } = await insert('filters={filters}');
    expect(result.issues).toEqual([]);
    expect(text).toContain('= ({ filters }) => {');
    expect(text).toContain('<FilterGroup filters={filters} />');
  });

  it('declares a missing variable of a basic type with a placeholder, and warns', async () => {
    const { result, text } = await insert('label={title} tags={tags} choices={options}');
    expect(codes(result)).toEqual(['value-placeholder', 'value-placeholder', 'value-placeholder']);
    expect(result.ok).toBe(true);
    expect(text).toContain(
      lines(
        'export const FiltersCard: React.FC<FiltersCardProps> = () => {',
        "  const title = ''; // placeholder: give it its real value",
        '  const tags: string[] = []; // placeholder: give it its real value',
        "  const options: React.ComponentProps<typeof FilterGroup>['choices'] = []; // placeholder: give it its real value",
        '  return (',
      ),
    );
  });

  it('refuses a missing variable of any other type: the variable is missing', async () => {
    const { result, text } = await insert('onChange={toggle}');
    expect(codes(result)).toEqual(['value-name-unknown']);
    expect(result.issues![0]!.message).toBe('"toggle" is not a prop of FiltersCard, a constant, nor an import of its file. It is given to "onChange" of FilterGroup, a () => void: not a basic type, so it gets no placeholder.');
    expect(result.issues![0]!.hint).toContain('The variable "toggle" is missing in FiltersCard');
    expect(text).toBe(TREE[cardFile]);
  });

  it('refuses a missing variable used in a value it is not the whole of', async () => {
    const { result } = await insert('label={user.name}');
    expect(codes(result)).toEqual(['value-name-unknown']);
  });

  it('gives a component that returns its JSX directly a body for the placeholder', async () => {
    const tree = { ...TREE, [cardFile]: lines("import { FilterGroup } from '../FilterGroup';", '', 'export const FiltersCard: React.FC = () => <div />;') };
    const { result, text } = await insert('count={total}', tree);
    expect(codes(result)).toEqual(['value-placeholder']);
    expect(text).toMatch(/= \(\) => \{\n {2}const total = 0; \/\/ placeholder: give it its real value\n {2}return <div>[\s\S]*<FilterGroup count=\{total\} \/>[\s\S]*;\n\};\n$/);
  });
});

describe('where the placeholder goes', () => {
  it('above the first if or return, and above the comments that describe it', async () => {
    const tree = {
      ...TREE,
      [cardFile]: TREE[cardFile]!.replace('  return (', '  const ready = true;\n\n  // Nothing to show yet.\n  if (!ready) return null;\n  return ('),
    };
    const { result, text } = await insert('label={title}', tree);
    expect(codes(result)).toEqual(['value-placeholder']);
    expect(text).toContain("  const ready = true;\n\n  const title = ''; // placeholder: give it its real value\n  // Nothing to show yet.\n  if (!ready) return null;\n");
  });
});

describe('element update: variables given to props', () => {
  it('declares a placeholder, as insert does', async () => {
    const tree = { ...TREE, [cardFile]: TREE[cardFile]!.replace('<FilterGroup />', '<FilterGroup label="x" />') };
    const root = await createProject(tree, { appFiles: 'root' });
    const result = await elementUpdateCommand.run({ cwd: root, args: { target: `${cardId}#div/FilterGroup` }, options: { text: undefined, props: 'open={expanded}', removeProps: undefined, dryRun: false } });
    expect(codes(result)).toEqual(['value-placeholder']);
    expect(await read(root, cardFile)).toContain('  const expanded = false; // placeholder: give it its real value\n  return (');
  });
});

describe('component create: variables given to the root', () => {
  it('declares a placeholder in the new component', async () => {
    const root = await createProject(TREE, { appFiles: 'root' });
    const result = await componentCreateCommand.run({
      cwd: root,
      args: { name: 'SizeGroup' },
      options: { feature: 'docs', app: false, type: undefined, interface: undefined, rootProps: 'size={size}', from: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, root: 'FilterGroup', text: undefined, dryRun: false },
    });
    expect(codes(result)).toEqual(['value-placeholder']);
    expect(await read(root, `${components}/SizeGroup/SizeGroup.tsx`)).toContain("  const size = 'sm'; // placeholder: give it its real value\n");
  });
});

describe('component update --default: variables given to the existing usages', () => {
  async function update(member: string, value: string) {
    const root = await createProject(TREE, { appFiles: 'root' });
    const result = await componentUpdateCommand.run({
      cwd: root,
      args: { target: 'FilterGroup' },
      options: { name: undefined, interface: member, removeInterface: undefined, renameInterface: undefined, default: value, feature: undefined, app: false, type: undefined, dryRun: false },
    });
    return { result, text: await read(root, cardFile) };
  }

  it('destructures a prop of the parent', async () => {
    const { result, text } = await update('filters: Filters', '{filters}');
    expect(result.issues).toEqual([]);
    expect(text).toContain('= ({ filters }) => {');
    expect(text).toContain('<FilterGroup filters={filters} />');
  });

  it('declares a placeholder for a missing variable of a basic type', async () => {
    const { result, text } = await update('tone: string', '{tone}');
    expect(codes(result)).toEqual(['value-placeholder']);
    expect(result.issues![0]!.path).toBe(cardFile);
    expect(text).toContain("  const tone = ''; // placeholder: give it its real value\n  return (");
    expect(text).toContain('<FilterGroup tone={tone} />');
  });

  it('refuses a missing variable of any other type, and changes nothing', async () => {
    const { result, text } = await update('choice: Choice', '{choice}');
    expect(codes(result)).toEqual(['value-name-unknown']);
    expect(text).toBe(TREE[cardFile]);
  });

  it('writes a literal as it is', async () => {
    const { result, text } = await update('tone: string', "'calm'");
    expect(result.issues).toEqual([]);
    expect(text).toContain("<FilterGroup tone='calm' />");
  });
});
