import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['icon-name', 'icon-library-mixed'] as const;

const config = { appFiles: 'app', icons: { library: 'lucide-react' } };
const topBar = 'src/app/components/TopBar/TopBar.tsx';

export const examples: RuleExample[] = [
  {
    title: 'Icons from the configured library, with the Icon suffix',
    config,
    tree: { [topBar]: "import { SearchIcon } from 'lucide-react';\nexport const TopBar: React.FC = () => <SearchIcon />;\n" },
    issues: [],
  },
  {
    title: 'An icon imported without the Icon suffix',
    config,
    tree: { [topBar]: "import { Search } from 'lucide-react';\nexport const TopBar: React.FC = () => <Search />;\n" },
    issues: [
      {
        issue: `error icon-name ${topBar}`,
        message: '"Search" is imported from lucide-react without the Icon suffix.',
        hint: 'Import it as SearchIcon: icon names alone (Search, User) are too generic for a project.',
      },
    ],
  },
  {
    title: 'An icon from another library',
    config,
    tree: { [topBar]: "import { FaSearch } from 'react-icons/fa';\nexport const TopBar: React.FC = () => <FaSearch />;\n" },
    issues: [`error icon-library-mixed ${topBar}`],
  },
];
