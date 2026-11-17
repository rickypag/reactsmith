import { describe, expect, it } from 'vitest';
import { componentUpdateCommand } from '../../src/commands/component/update/command.js';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, exists, read } from '../helpers.js';

const lines = (...text: string[]) => `${text.join('\n')}\n`;
const userCard = 'src/features/docs/components/UserCard';
const card = 'src/components/cards/Card';
const view = 'src/features/docs/views/HomeView/HomeView.tsx';

const TREE = {
  'src/features/docs/index.ts': '',
  [`${userCard}/UserCard.tsx`]: lines(
    "import styles from './UserCard.module.css';",
    '',
    'export interface UserCardProps {',
    '  name: string;',
    '}',
    '',
    'export const UserCard: React.FC<UserCardProps> = ({ name }) => {',
    '  return <div className={styles.root}>{name}</div>;',
    '};',
  ),
  [`${userCard}/UserCard.module.css`]: '.root {\n}\n',
  [`${userCard}/index.ts`]: "export { UserCard } from './UserCard';\nexport type { UserCardProps } from './UserCard';\n",
  [`${card}/Card.tsx`]: lines(
    "import styles from './Card.module.css';",
    '',
    'export interface CardProps {',
    '  label: string;',
    '  elevated?: boolean;',
    '  children?: React.ReactNode;',
    '}',
    '',
    'export const Card: React.FC<CardProps> = ({ label, children }) => {',
    '  return <div className={styles.root}><h2>{label}</h2>{children}</div>;',
    '};',
  ),
  [`${card}/Card.module.css`]: '.root {\n}\n',
  [`${card}/index.ts`]: "export { Card } from './Card';\nexport type { CardProps } from './Card';\n",
  'src/components/cards/index.ts': "export { Card } from './Card';\nexport type { CardProps } from './Card';\n",
  [view]: lines(
    "import styles from './HomeView.module.css';",
    "import { Card } from '@/components/cards';",
    "import { UserCard } from '../../components/UserCard';",
    '',
    'export const HomeView: React.FC = () => {',
    '  return (',
    '    <div className={styles.root}>',
    "      <Card label='Docs' elevated>",
    "        <UserCard name='Ada' />",
    '      </Card>',
    '    </div>',
    '  );',
    '};',
  ),
  'src/features/docs/views/HomeView/HomeView.module.css': '.root {\n}\n',
  'src/features/docs/views/HomeView/index.ts': "export { HomeView as Component } from './HomeView';\n",
};

interface Options {
  name?: string;
  interface?: string;
  removeInterface?: string;
  renameInterface?: string;
  default?: string;
}

async function update(target: string, options: Options, tree: Record<string, string> = TREE) {
  const root = await createProject(tree, { appFiles: 'app' });
  const result = await componentUpdateCommand.run({
    cwd: root,
    args: { target },
    options: { name: options.name, interface: options.interface, removeInterface: options.removeInterface, renameInterface: options.renameInterface, default: options.default, feature: undefined, app: false, type: undefined, dryRun: false },
  });
  return { root, result };
}

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);
const errors = async (root: string) => (await checkStructure(root)).issues.filter((issue) => issue.severity === 'error');

describe('component update --name', () => {
  it('renames a feature component: folder, files, code, and its usages', async () => {
    const { root, result } = await update('UserCard', { name: 'ProfileCard' });
    expect(result.issues).toEqual([]);
    const folder = 'src/features/docs/components/ProfileCard';
    expect(await exists(root, userCard)).toBe(false);
    expect(await read(root, `${folder}/ProfileCard.tsx`)).toBe(
      lines(
        "import styles from './ProfileCard.module.css';",
        '',
        'export interface ProfileCardProps {',
        '  name: string;',
        '}',
        '',
        'export const ProfileCard: React.FC<ProfileCardProps> = ({ name }) => {',
        '  return <div className={styles.root}>{name}</div>;',
        '};',
      ),
    );
    expect(await exists(root, `${folder}/ProfileCard.module.css`)).toBe(true);
    expect(await read(root, `${folder}/index.ts`)).toBe("export { ProfileCard } from './ProfileCard';\nexport type { ProfileCardProps } from './ProfileCard';\n");
    const text = await read(root, view);
    expect(text).toContain("import { ProfileCard } from '../../components/ProfileCard';");
    expect(text).toContain("<ProfileCard name='Ada' />");
    expect(await errors(root)).toEqual([]);
  });

  it('renames a shared component in its type barrel, and keeps a local alias', async () => {
    const aliased = { ...TREE, [view]: TREE[view]!.replace("import { Card } from '@/components/cards';", "import { Card as Box } from '@/components/cards';").replace(/<Card /, '<Box ').replace('</Card>', '</Box>') };
    const { root, result } = await update('src/components/cards/Card', { name: 'InfoCard' }, aliased);
    expect(result.issues).toEqual([]);
    expect(await read(root, 'src/components/cards/index.ts')).toBe("export { InfoCard } from './InfoCard';\nexport type { InfoCardProps } from './InfoCard';\n");
    const text = await read(root, view);
    expect(text).toContain("import { InfoCard as Box } from '@/components/cards';");
    expect(text).toContain("<Box label='Docs' elevated>");
    expect(await errors(root)).toEqual([]);
  });

  it('refuses a taken or invalid name, and an unknown component', async () => {
    expect(codes((await update('UserCard', { name: 'Card' })).result)).toEqual(['component-name-taken']);
    expect(codes((await update('UserCard', { name: 'profile-card' })).result)).toEqual(['component-name-invalid']);
    expect(codes((await update('Nope', { name: 'Other' })).result)).toEqual(['component-missing']);
  });
});

describe('component update: interface', () => {
  it('adds an optional prop, and changes the type of an existing one', async () => {
    const { root, result } = await update('Card', { interface: "size?: 'sm' | 'lg'; label: React.ReactNode" });
    expect(result.issues).toEqual([]);
    const text = await read(root, `${card}/Card.tsx`);
    expect(text).toContain("  label: React.ReactNode;\n  elevated?: boolean;\n  children?: React.ReactNode;\n  size?: 'sm' | 'lg';\n}");
  });

  it('adds a required prop only with a value for the existing usages', async () => {
    const refused = await update('UserCard', { interface: 'role: string' });
    expect(codes(refused.result)).toEqual(['props-required-usages']);
    const { root, result } = await update('UserCard', { interface: 'role: string', default: "'reader'" });
    expect(result.issues).toEqual([]);
    expect(await read(root, view)).toContain("<UserCard name='Ada' role='reader' />");
    expect(await read(root, `${userCard}/UserCard.tsx`)).toContain('  name: string;\n  role: string;\n}');
  });

  it('removes a prop no one uses, and refuses one still used by the component or a usage', async () => {
    expect(codes((await update('Card', { removeInterface: 'label' })).result)).toEqual(['prop-in-use']);
    const usedByView = await update('Card', { removeInterface: 'elevated' });
    expect(usedByView.result.issues?.map((issue) => issue.hint)).toEqual(['Remove it there first: "element update <element> --remove-props elevated".']);
    const unused = { ...TREE, [view]: TREE[view]!.replace(" elevated>", '>') };
    const { root, result } = await update('Card', { removeInterface: 'elevated' }, unused);
    expect(result.issues).toEqual([]);
    expect(await read(root, `${card}/Card.tsx`)).toContain('  label: string;\n  children?: React.ReactNode;\n}');
  });

  it('renames a prop in the interface, the component and every usage', async () => {
    const { root, result } = await update('Card', { renameInterface: 'label=title' });
    expect(result.issues).toEqual([]);
    const text = await read(root, `${card}/Card.tsx`);
    expect(text).toContain('  title: string;');
    expect(text).toContain('= ({ title, children }) => {');
    expect(text).toContain('<h2>{title}</h2>');
    expect(await read(root, view)).toContain("<Card title='Docs' elevated>");
  });

  it('refuses to rename a prop that may come through a spread', async () => {
    const spread = { ...TREE, [view]: TREE[view]!.replace("<Card label='Docs' elevated>", '<Card {...data}>') };
    expect(codes((await update('Card', { renameInterface: 'label=title' }, spread)).result)).toEqual(['prop-rename-spread']);
  });

  it('renames and changes the interface in one call, all or nothing', async () => {
    const { root, result } = await update('UserCard', { name: 'ProfileCard', renameInterface: 'name=fullName' });
    expect(result.issues).toEqual([]);
    expect(await read(root, 'src/features/docs/components/ProfileCard/ProfileCard.tsx')).toContain('= ({ fullName }) => {');
    expect(await read(root, view)).toContain("<ProfileCard fullName='Ada' />");

    const refused = await update('UserCard', { name: 'ProfileCard', removeInterface: 'name' });
    expect(codes(refused.result)).toEqual(['prop-in-use']);
    expect(await exists(refused.root, userCard)).toBe(true);
  });
});

const logo = 'src/features/docs/components/Logo';
const pill = 'src/components/badges/Pill';
/** Components without props: a feature one, and a shared one offered by its type barrel. */
const WITHOUT_PROPS = {
  ...TREE,
  [`${logo}/Logo.tsx`]: lines(
    "import styles from './Logo.module.css';",
    '',
    'export const Logo: React.FC = () => {',
    '  return <div className={styles.root}><span className={styles.name}>ReactSmith</span></div>;',
    '};',
  ),
  [`${logo}/Logo.module.css`]: '.root {\n}\n\n.name {\n}\n',
  [`${logo}/index.ts`]: "export { Logo } from './Logo';\n",
  [`${pill}/Pill.tsx`]: lines("import styles from './Pill.module.css';", '', 'export const Pill: React.FC = () => {', '  return <span className={styles.root} />;', '};'),
  [`${pill}/Pill.module.css`]: '.root {\n}\n',
  [`${pill}/index.ts`]: "export { Pill } from './Pill';\n",
  'src/components/badges/index.ts': "export { Pill } from './Pill';\n",
};

describe('component update: creating and removing the interface', () => {
  it('creates the interface with the first prop, typing the component and exporting the type', async () => {
    const { root, result } = await update('Logo', { interface: 'compact?: boolean' }, WITHOUT_PROPS);
    expect(result.issues).toEqual([]);
    expect(await read(root, `${logo}/Logo.tsx`)).toBe(
      lines(
        "import styles from './Logo.module.css';",
        '',
        'export interface LogoProps {',
        '  compact?: boolean;',
        '}',
        '',
        'export const Logo: React.FC<LogoProps> = () => {',
        '  return <div className={styles.root}><span className={styles.name}>ReactSmith</span></div>;',
        '};',
      ),
    );
    expect(await read(root, `${logo}/index.ts`)).toBe("export { Logo } from './Logo';\nexport type { LogoProps } from './Logo';\n");
    expect(await errors(root)).toEqual([]);
  });

  it('exports a shared component\'s new props type from its type barrel too', async () => {
    const { root, result } = await update('Pill', { interface: 'label: string', default: "'new'" }, WITHOUT_PROPS);
    expect(result.issues).toEqual([]);
    expect(await read(root, 'src/components/badges/index.ts')).toBe("export { Pill } from './Pill';\nexport type { PillProps } from './Pill';\n");
  });

  it('removes the interface with its last prop, and its exports', async () => {
    const tree = { ...TREE, [view]: TREE[view]!.replace("<UserCard name='Ada' />", '<p />').replace("import { UserCard } from '../../components/UserCard';\n", '') };
    const withoutName = { ...tree, [`${userCard}/UserCard.tsx`]: tree[`${userCard}/UserCard.tsx`]!.replace('({ name })', '()').replace('{name}', 'Ada') };
    const { root, result } = await update('UserCard', { removeInterface: 'name' }, withoutName);
    expect(result.issues).toEqual([]);
    expect(await read(root, `${userCard}/UserCard.tsx`)).toBe(
      lines("import styles from './UserCard.module.css';", '', 'export const UserCard: React.FC = () => {', '  return <div className={styles.root}>Ada</div>;', '};'),
    );
    expect(await read(root, `${userCard}/index.ts`)).toBe("export { UserCard } from './UserCard';\n");
  });

  it('keeps an empty interface that other files still name, with a warning', async () => {
    const tree = { ...TREE, [view]: TREE[view]!.replace("<UserCard name='Ada' />", '<p />').replace("import { UserCard } from '../../components/UserCard';\n", '') };
    const named = {
      ...tree,
      [`${userCard}/UserCard.tsx`]: tree[`${userCard}/UserCard.tsx`]!.replace('({ name })', '()').replace('{name}', 'Ada'),
      'src/features/docs/types.ts': "import type { UserCardProps } from './components/UserCard';\n\nexport type Card = UserCardProps;\n",
    };
    const { root, result } = await update('UserCard', { removeInterface: 'name' }, named);
    expect(codes(result)).toEqual(['props-interface-kept']);
    expect(await read(root, `${userCard}/UserCard.tsx`)).toContain('export interface UserCardProps {\n}');
  });
});

describe('component update: placeholder types', () => {
  it('replaces a placeholder with the real type once the project has it, and removes types.ts', async () => {
    const list = 'src/features/docs/components/List';
    const item = 'src/features/docs/components/Item';
    const tree = {
      ...TREE,
      [`${list}/List.tsx`]: lines(
        "import type { ItemProps } from './types';",
        "import styles from './List.module.css';",
        '',
        'export interface ListProps {',
        '  items: ItemProps[];',
        '}',
        '',
        'export const List: React.FC<ListProps> = () => {',
        '  return <ul className={styles.root} />;',
        '};',
      ),
      [`${list}/List.module.css`]: '.root {\n}\n',
      [`${list}/index.ts`]: "export { List } from './List';\nexport type { ListProps } from './List';\n",
      [`${list}/types.ts`]: '// Placeholders so the component compiles: define each type here,\n// or import the real one where it is used and delete it here.\nexport type ItemProps = unknown;\n',
      [`${item}/Item.tsx`]: "export interface ItemProps {\n  text: string;\n}\n\nexport const Item: React.FC<ItemProps> = ({ text }) => <li>{text}</li>;\n",
      [`${item}/index.ts`]: "export { Item } from './Item';\nexport type { ItemProps } from './Item';\n",
    };
    const { root, result } = await update('List', { interface: 'items: ItemProps[]' }, tree);
    expect(result.issues).toEqual([]);
    const text = await read(root, `${list}/List.tsx`);
    expect(text).toContain("import type { ItemProps } from '../Item';");
    expect(text).not.toContain("'./types'");
    expect(await exists(root, `${list}/types.ts`)).toBe(false);
  });
});

describe('component update: default values', () => {
  const insertAround = (root: string, name: string, around: string) =>
    elementInsertCommand.run({
      cwd: root,
      args: { name },
      options: { around, through: undefined, if: undefined, fallback: undefined, into: undefined, position: undefined, from: undefined, props: undefined, text: undefined, message: undefined, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
    });

  it('writes the default in the interface, and where the prop is destructured once it is used', async () => {
    const { root, result } = await update('Logo', { interface: 'showName?: boolean = true' }, WITHOUT_PROPS);
    expect(result.issues).toEqual([]);
    expect(await read(root, `${logo}/Logo.tsx`)).toContain('export interface LogoProps {\n  /** @default true */\n  showName?: boolean;\n}');
    // Not destructured yet: an unused destructured prop fails noUnusedParameters.
    expect(await read(root, `${logo}/Logo.tsx`)).toContain('React.FC<LogoProps> = () =>');

    const inserted = await insertAround(root, '{?showName}', 'features/docs/components/Logo/Logo.tsx#name');
    expect(inserted.issues).toEqual([]);
    const text = await read(root, `${logo}/Logo.tsx`);
    expect(text).toContain('React.FC<LogoProps> = ({ showName = true }) =>');
    expect(text).toContain('{showName && <span className={styles.name}>ReactSmith</span>}');
  });

  it('sets, changes and takes away the default of a prop already destructured', async () => {
    const withDefault = await update('Card', { interface: "label?: string = 'Docs'" });
    expect(withDefault.result.issues).toEqual([]);
    const text = await read(withDefault.root, `${card}/Card.tsx`);
    expect(text).toContain("  /** @default 'Docs' */\n  label?: string;\n  elevated?: boolean;");
    expect(text).toContain("= ({ label = 'Docs', children }) => {");

    const tree = { ...TREE, [`${card}/Card.tsx`]: text };
    const changed = await update('Card', { interface: "label?: string = 'Home'" }, tree);
    expect(await read(changed.root, `${card}/Card.tsx`)).toContain("  /** @default 'Home' */\n  label?: string;");
    expect(await read(changed.root, `${card}/Card.tsx`)).toContain("({ label = 'Home', children })");

    const without = await update('Card', { interface: 'label?: string' }, tree);
    expect(await read(without.root, `${card}/Card.tsx`)).toContain('  label?: string;\n  elevated?: boolean;');
    expect(await read(without.root, `${card}/Card.tsx`)).not.toContain('@default');
    expect(await read(without.root, `${card}/Card.tsx`)).toContain('({ label, children })');
  });

  it('refuses a default on a required prop, or one that is not a value', async () => {
    const required = await update('Card', { interface: 'size: string = 2' });
    expect(codes(required.result)).toEqual(['props-invalid']);
    expect(required.result.issues?.[0]?.hint).toBe('Make it optional: "size?: <type> = 2".');
    expect(codes((await update('Card', { interface: 'size?: string =' })).result)).toEqual(['props-invalid']);
    expect(codes((await update('Card', { interface: 'size?: string = (' })).result)).toEqual(['props-invalid']);
  });

  it('keeps "=" inside a type: function types and object types', async () => {
    const { root, result } = await update('Card', { interface: 'onPick?: (id: string) => void; options?: { compact: boolean; gap: number } = { compact: true, gap: 2 }' });
    expect(result.issues).toEqual([]);
    const text = await read(root, `${card}/Card.tsx`);
    expect(text).toContain('  onPick?: (id: string) => void;\n');
    expect(text).toContain('  /** @default { compact: true, gap: 2 } */\n  options?: { compact: boolean; gap: number };');
  });
});

describe('component update: props given through a spread', () => {
  const feature = 'src/features/docs';
  const spreadTree = (data: string) => ({
    'src/features/docs/index.ts': '',
    [`${feature}/constants.ts`]: `export const FEATURES = [${data}];\n`,
    [`${feature}/components/FeatureItem/FeatureItem.tsx`]: 'export interface FeatureItemProps {\n  title: string;\n  description: string;\n}\n\nexport const FeatureItem: React.FC<FeatureItemProps> = ({ title }) => <h3>{title}</h3>;\n',
    [`${feature}/components/FeatureItem/index.ts`]: "export { FeatureItem } from './FeatureItem';\n",
    [view]: "import { FEATURES } from '../../constants';\nimport { FeatureItem } from '../../components/FeatureItem';\n\nexport const HomeView: React.FC = () => {\n  return <div>{FEATURES.map((feature) => <FeatureItem key={feature.title} {...feature} />)}</div>;\n};\n",
    'tsconfig.app.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, lib: ['ES2022', 'DOM'] }, include: ['src'] }),
  });
  const PLAIN = "{ title: 'Caching', description: 'Fast answers.' }";

  /** A project with the repo's real React types, so TypeScript says whether the spread data fits. */
  async function withTypes(data: string, test: (run: (members: string, value?: string) => ReturnType<typeof componentUpdateCommand.run>, root: string) => Promise<void>) {
    const { symlink, unlink } = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = await createProject(spreadTree(data), { appFiles: 'app' });
    const modules = path.join(root, 'node_modules');
    await symlink(fileURLToPath(new URL('../../../../node_modules', import.meta.url)), modules, 'junction');
    const run = (members: string, value?: string) =>
      componentUpdateCommand.run({ cwd: root, args: { target: 'FeatureItem' }, options: { name: undefined, interface: members, removeInterface: undefined, renameInterface: undefined, default: value, feature: undefined, app: false, type: undefined, dryRun: false } });
    try {
      await test(run, root);
    } finally {
      await unlink(modules);
    }
  }

  it('refuses a new required prop the spread data lacks, without a value for it', () =>
    withTypes(PLAIN, async (run) => {
      const refused = await run('icon: string');
      expect(codes(refused)).toEqual(['props-spread-incompatible']);
      expect(refused.issues?.[0]?.message).toContain("Property 'icon' is missing");
      expect(refused.issues?.[0]?.hint).toContain('--default');
      expect((await run('icon?: string')).issues).toEqual([]);
    }), 30_000);

  it('leaves the usage alone when the spread data already gives the new prop', () =>
    withTypes("{ title: 'Caching', description: 'Fast answers.', icon: 'bolt' }", async (run, root) => {
      expect((await run('icon: string', "'star'")).issues).toEqual([]);
      expect(await read(root, view)).toContain('<FeatureItem key={feature.title} {...feature} />');
    }), 30_000);

  it('gives the new prop inline, next to the spread, when the data lacks it', () =>
    withTypes(PLAIN, async (run, root) => {
      expect((await run('icon: string', "'star'")).issues).toEqual([]);
      expect(await read(root, view)).toContain("<FeatureItem key={feature.title} {...feature} icon='star' />");
    }), 30_000);

  it('resolves a variable given inline as any prop: a placeholder for a basic type, else a refusal', () =>
    withTypes(PLAIN, async (run, root) => {
      expect(codes(await run('icon: string', '{icon}'))).toEqual(['value-placeholder']);
      const text = await read(root, view);
      expect(text).toContain("  const icon = ''; // placeholder: give it its real value\n");
      expect(text).toContain('{...feature} icon={icon} />');
      expect(codes(await run('onPick: () => void', '{pick}'))).toEqual(['value-name-unknown']);
    }), 30_000);

  it('refuses a changed prop the data no longer fits, even with a value: inline, it would override the data', () =>
    withTypes(PLAIN, async (run, root) => {
      expect(codes(await run('description: number', '{0}'))).toEqual(['props-spread-incompatible']);
      expect(await read(root, view)).toContain('{...feature} />');
    }), 30_000);
});
