import { describe, expect, it } from 'vitest';
import { componentUpdateCommand } from '../../src/commands/component/update/command.js';
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
    options: { name: options.name, interface: options.interface, removeInterface: options.removeInterface, renameInterface: options.renameInterface, default: options.default, dryRun: false },
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
