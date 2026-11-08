import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['component-unused', 'style-unused'] as const;

const config = { appFiles: 'app' };
const topBar = 'src/app/components/TopBar';

export const examples: RuleExample[] = [
  {
    title: 'A component the app renders, using all its styles',
    config,
    tree: {
      [`${topBar}/TopBar.tsx`]: "import styles from './TopBar.module.css';\nexport const TopBar: React.FC = () => <header className={styles.root} />;\n",
      [`${topBar}/TopBar.module.css`]: '.root {\n  display: flex;\n}\n',
      [`${topBar}/index.ts`]: "export { TopBar } from './TopBar';\n",
      'src/app/App.tsx': "import { TopBar } from './components/TopBar';\nexport const App = () => <TopBar />;\n",
    },
    issues: [],
  },
  {
    title: 'A component nothing renders',
    config,
    tree: { [`${topBar}/TopBar.tsx`]: '', [`${topBar}/index.ts`]: "export { TopBar } from './TopBar';\n" },
    issues: [`warning component-unused ${topBar}`],
  },
  {
    title: 'A style no element uses',
    config,
    tree: {
      [`${topBar}/TopBar.tsx`]: "import styles from './TopBar.module.css';\nexport const TopBar: React.FC = () => <header className={styles.root} />;\n",
      [`${topBar}/TopBar.module.css`]: '.root {\n  display: flex;\n}\n\n.title {\n  font-weight: 600;\n}\n',
      [`${topBar}/index.ts`]: "export { TopBar } from './TopBar';\n",
      'src/app/App.tsx': "import { TopBar } from './components/TopBar';\nexport const App = () => <TopBar />;\n",
    },
    issues: [
      {
        issue: `warning style-unused ${topBar}/TopBar.module.css`,
        message: 'The style "title" is not used: no element of TopBar.tsx has className={styles.title}.',
        hint: 'Give it to an element with "style update <element> --name title", or delete its rule.',
      },
    ],
  },
];
