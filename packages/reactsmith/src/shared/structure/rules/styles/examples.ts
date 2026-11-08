import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = [
  'inline-style-limit',
  'inline-style-not-literal',
  'component-inline-style',
  'component-not-styleable',
  'styleable-not-merged',
] as const;

/** The parts of the rule, in page order. */
export const sections = {
  inline: 'Inline styles',
  components: 'Styling a component',
} as const;

const config = { appFiles: 'app' };
const topBar = 'src/app/components/TopBar/TopBar.tsx';
const brand = 'src/app/components/Brand/Brand.tsx';

/** A TopBar component rendering `jsx`, with its style file and the Brand component imported. */
const topBarFile = (jsx: string) =>
  `import { Brand } from '../Brand';\nimport styles from './TopBar.module.css';\n\nexport const TopBar: React.FC = () => {\n  return ${jsx};\n};\n`;

const BRAND = { [brand]: 'export const Brand: React.FC = () => <span />;\n' };

export const examples: RuleExample<keyof typeof sections>[] = [
  {
    title: 'Classes from the style file, and a few inline ones',
    config,
    tree: { ...BRAND, [topBar]: topBarFile('<header className={styles.root}><Brand /><span className="sr-only">Docs</span></header>') },
    issues: [],
  },
  {
    section: 'inline',
    title: 'More inline classes than the limit',
    config,
    tree: { ...BRAND, [topBar]: topBarFile('<header className="flex items-center gap-2 px-4" />') },
    issues: [
      {
        issue: `error inline-style-limit ${topBar}`,
        message: '<header> (line 5) has 4 inline classes, more than the 3 allowed.',
      },
    ],
  },
  {
    section: 'inline',
    title: 'An inline style that is not written in place',
    config,
    tree: { ...BRAND, [topBar]: topBarFile('<header style={headerStyle} />') },
    issues: [`error inline-style-not-literal ${topBar}`],
  },
  {
    section: 'components',
    title: 'An inline style on a component of the project',
    config,
    tree: { ...BRAND, [topBar]: topBarFile("<header><Brand style={{ color: 'red' }} /></header>") },
    issues: [`error component-inline-style ${topBar}`],
  },
  {
    section: 'components',
    title: 'A class on a component that does not take one',
    config,
    tree: { ...BRAND, [topBar]: topBarFile('<header><Brand className={styles.brand} /></header>') },
    issues: [`error component-not-styleable ${topBar}`],
  },
  {
    section: 'components',
    title: 'A styleable component that does not merge the class into its root',
    config,
    tree: {
      [brand]:
        "import type { StyleableProps } from '../../../types/styleable';\n\nexport interface BrandProps extends StyleableProps {}\n\nexport const Brand: React.FC<BrandProps> = () => <span />;\n",
    },
    issues: [`error styleable-not-merged ${brand}`],
  },
];
