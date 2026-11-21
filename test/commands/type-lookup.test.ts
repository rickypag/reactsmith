import { describe, expect, it } from 'vitest';
import { componentCreateCommand } from '../../src/commands/component/create/command.js';
import { componentUpdateCommand } from '../../src/commands/component/update/command.js';
import { createProject, exists, read } from '../helpers.js';

const TREE = {
  'src/app/components/SidebarLink/SidebarLink.tsx': "export interface SidebarLinkProps {\n  label: string;\n}\n\nexport const SidebarLink: React.FC<SidebarLinkProps> = ({ label }) => <a>{label}</a>;\n",
  'src/app/components/SidebarLink/index.ts': "export { SidebarLink } from './SidebarLink';\nexport type { SidebarLinkProps } from './SidebarLink';\n",
  'src/components/cards/Card/Card.tsx': "export interface CardProps {\n  title: string;\n}\n\nexport const Card: React.FC<CardProps> = ({ title }) => <div>{title}</div>;\n",
  'src/components/cards/Card/index.ts': "export { Card } from './Card';\nexport type { CardProps } from './Card';\n",
  'src/components/cards/index.ts': "export { Card } from './Card';\nexport type { CardProps } from './Card';\n",
  'src/types/index.ts': "export type { StyleableProps } from './styleable';\nexport interface User {\n  name: string;\n}\n",
  'src/types/styleable.ts': 'export interface StyleableProps {\n  className?: string;\n}\n',
  'src/features/billing/index.ts': '',
  'src/features/billing/types/index.ts': "export type Plan = 'free' | 'pro';\n",
  'src/features/billing/components/PlanBadge/PlanBadge.tsx': "export interface PlanBadgeProps {\n  plan: string;\n}\n\nexport const PlanBadge: React.FC<PlanBadgeProps> = ({ plan }) => <span>{plan}</span>;\n",
  'src/features/billing/components/PlanBadge/index.ts': "export { PlanBadge } from './PlanBadge';\nexport type { PlanBadgeProps } from './PlanBadge';\n",
  'src/features/docs/index.ts': '',
};

const create = (root: string, name: string, owner: { app?: boolean; feature?: string }, members: string) =>
  componentCreateCommand.run({
    cwd: root,
    args: { name },
    options: { feature: owner.feature, app: owner.app ?? false, type: undefined, interface: members, rootProps: undefined, from: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, root: undefined, text: undefined, jsx: undefined, replace: false, dryRun: false },
  });

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code) ?? [];

describe('types in --interface: found like components', () => {
  it('imports the props of another component, without a placeholder', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    expect(codes(await create(root, 'SidebarGroup', { app: true }, 'title: string; items: SidebarLinkProps[]'))).toEqual([]);
    expect(await read(root, 'src/app/components/SidebarGroup/SidebarGroup.tsx')).toContain("import type { SidebarLinkProps } from '../SidebarLink';");
    expect(await exists(root, 'src/app/components/SidebarGroup/types.ts')).toBe(false);
  });

  it('imports shared components through their type, and the types/ folders: the shared one and the feature\'s', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    expect(codes(await create(root, 'PlanCard', { feature: 'billing' }, 'card: CardProps; owner: User; plan: Plan'))).toEqual([]);
    const text = await read(root, 'src/features/billing/components/PlanCard/PlanCard.tsx');
    expect(text).toContain("import type { CardProps } from '@/components/cards';");
    expect(text).toContain("import type { User } from '@/types';");
    expect(text).toContain("import type { Plan } from '../../types';");
  });

  it('follows the import rules: another feature\'s components are not found', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    const result = await create(root, 'Pricing', { feature: 'docs' }, 'badge: PlanBadgeProps');
    expect(codes(result)).toEqual(['type-placeholder']);
    expect(await read(root, 'src/features/docs/components/Pricing/types.ts')).toContain('export type PlanBadgeProps = unknown;');
  });

  it('leaves a type offered by two places as a placeholder, saying where it is', async () => {
    const root = await createProject({ ...TREE, 'src/types/index.ts': "export interface CardProps {\n  title: string;\n}\n" }, { appFiles: 'app' });
    const result = await create(root, 'Grid', { app: true }, 'cards: CardProps[]');
    expect(codes(result)).toEqual(['type-placeholder']);
    expect(result.issues?.[0]?.hint).toContain('"CardProps" is in @/components/cards and @/types');
  });

  it('imports them in component update too', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    await create(root, 'Nav', { app: true }, 'title: string');
    const result = await componentUpdateCommand.run({
      cwd: root,
      args: { target: 'Nav' },
      options: { name: undefined, interface: 'links?: SidebarLinkProps[]', removeInterface: undefined, renameInterface: undefined, default: undefined, feature: undefined, app: false, type: undefined, dryRun: false },
    });
    expect(codes(result)).toEqual([]);
    expect(await read(root, 'src/app/components/Nav/Nav.tsx')).toContain("import type { SidebarLinkProps } from '../SidebarLink';");
  });

  it('drops the type imports only a removed or replaced prop used', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    await create(root, 'PlanCard', { feature: 'billing' }, 'plan?: Plan; owner?: User; card?: CardProps; backup?: CardProps');
    const update = (options: { interface?: string; removeInterface?: string }) =>
      componentUpdateCommand.run({
        cwd: root,
        args: { target: 'PlanCard' },
        options: { name: undefined, interface: options.interface, removeInterface: options.removeInterface, renameInterface: undefined, default: undefined, feature: undefined, app: false, type: undefined, dryRun: false },
      });
    const file = 'src/features/billing/components/PlanCard/PlanCard.tsx';
    expect(codes(await update({ removeInterface: 'plan card' }))).toEqual([]);
    let text = await read(root, file);
    expect(text).not.toContain('Plan }');
    expect(text).toContain("import type { CardProps } from '@/components/cards';");
    expect(codes(await update({ interface: 'owner?: string' }))).toEqual([]);
    text = await read(root, file);
    expect(text).not.toContain('@/types');
    expect(text).toContain('owner?: string;');
  });
});
