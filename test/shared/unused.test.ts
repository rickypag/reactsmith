import { describe, expect, it } from 'vitest';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject } from '../helpers.js';

const dir = 'src/app/components/TopBar';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const unused = async (root: string, code: string) => (await checkStructure(root)).issues.filter((issue) => issue.code === code);

const component = (folder: string, name: string) => ({
  [`${folder}/${name}/${name}.tsx`]: `export const ${name}: React.FC = () => <div />;\n`,
  [`${folder}/${name}/index.ts`]: `export { ${name} } from './${name}';\n`,
});

describe('check: style-unused', () => {
  const topBar = (body: string) =>
    lines("import styles from './TopBar.module.css';", '', 'export const TopBar: React.FC = () => {', `  return <header className={styles.root}>${body}</header>;`, '};');

  it('warns about the classes of a CSS module that the component never uses', async () => {
    const root = await createProject(
      {
        [`${dir}/TopBar.tsx`]: topBar('<span className={styles.brand}>Docs</span><span className={styles["badge"]}>New</span>'),
        [`${dir}/index.ts`]: "export { TopBar } from './TopBar';\n",
        [`${dir}/TopBar.module.css`]: lines(
          '/* .commented { } */',
          '.root {',
          '  padding: 0.5rem;',
          '  &.active {',
          '    color: red;',
          '  }',
          '}',
          '.brand:hover { opacity: 0.8; }',
          '.badge { color: blue; }',
          '.root[data-selected="true"] .label { color: blue; }',
          '@media (min-width: 40rem) {',
          '  .search { display: block; }',
          '}',
        ),
      },
      { appFiles: 'app' },
    );
    const issues = await unused(root, 'style-unused');
    expect(issues.map((issue) => issue.message)).toEqual([
      'The style "active" is not used: no element of TopBar.tsx has className={styles.active}.',
      'The style "label" is not used: no element of TopBar.tsx has className={styles.label}.',
      'The style "search" is not used: no element of TopBar.tsx has className={styles.search}.',
    ]);
    expect(issues[0]?.path).toBe(`${dir}/TopBar.module.css`);
    expect(issues[0]?.severity).toBe('warning');
  });

  it('reads the keys of a Tailwind styles file, and skips styles read by a computed key', async () => {
    const root = await createProject(
      {
        [`${dir}/TopBar.tsx`]: lines("import { styles } from './TopBar.styles';", '', "export const TopBar: React.FC = () => <header className={styles.root} />;"),
        [`${dir}/TopBar.styles.ts`]: lines('export const styles = {', "  root: 'flex',", "  brand: 'font-bold',", '};'),
        'src/app/components/Badge/Badge.tsx': lines("import styles from './Badge.module.css';", '', "export const Badge: React.FC<{ tone: string }> = ({ tone }) => <span className={styles[tone]} />;"),
        'src/app/components/Badge/Badge.module.css': '.info {}\n.error {}\n',
      },
      { appFiles: 'app', styles: 'tailwind' },
    );
    expect((await unused(root, 'style-unused')).map((issue) => `${issue.path} ${issue.message}`)).toEqual([
      `${dir}/TopBar.styles.ts The style "brand" is not used: no element of TopBar.tsx has className={styles.brand}.`,
    ]);
  });
});

describe('check: component-unused', () => {
  it('warns about components and layouts nothing outside their folder imports', async () => {
    const root = await createProject(
      {
        ...component('src/app/components', 'TopBar'),
        ...component('src/app/components', 'Sidebar'),
        ...component('src/app/layouts', 'RootLayout'),
        ...component('src/components/buttons', 'PrimaryButton'),
        ...component('src/components/buttons', 'IconButton'),
        ...component('src/components/cards', 'Card'),
        'src/components/buttons/index.ts': "export { PrimaryButton } from './PrimaryButton';\nexport { IconButton } from './IconButton';\n",
        'src/components/cards/index.ts': "export { Card } from './Card';\nexport type { CardProps } from './Card';\n",
        'src/app/components/TopBar/TopBar.tsx': lines(
          "import { PrimaryButton } from '@/components/buttons';",
          "import type { CardProps } from '@/components/cards';",
          "import { Sidebar } from '../Sidebar';",
          '',
          'export const TopBar: React.FC = () => <header><PrimaryButton /><Sidebar /></header>;',
        ),
      },
      { appFiles: 'app' },
    );
    expect((await unused(root, 'component-unused')).map((issue) => issue.message).sort()).toEqual([
      'Component "IconButton" is not used: nothing outside its folder imports it.',
      'Component "TopBar" is not used: nothing outside its folder imports it.',
      'Layout "RootLayout" is not used: nothing outside its folder imports it.',
    ]);
  });
});
