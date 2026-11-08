import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = [
  'text-outside-text-element',
  'list-shape-invalid',
  'condition-shape-invalid',
  'plain-internal-link',
  'table-content-invalid',
] as const;

/** The parts of the rule, in page order. */
export const sections = {
  text: 'Text',
  lists: 'Lists and conditions',
  links: 'Links',
  tables: 'Tables',
} as const;

const config = { appFiles: 'app' };
const router = { library: 'react-router', version: 7, mode: 'data' };
const topBar = 'src/app/components/TopBar/TopBar.tsx';

/** A TopBar component rendering `jsx`. */
const component = (jsx: string) => `export const TopBar: React.FC = () => {\n  return ${jsx};\n};\n`;

export const examples: RuleExample<keyof typeof sections>[] = [
  {
    title: 'Text in text elements, a list of components and a condition',
    config,
    tree: {
      [topBar]: component('<header><h1>Docs</h1>{open && <p>Menu</p>}{links.map((link) => <NavLink key={link.href} {...link} />)}</header>'),
    },
    issues: [],
  },
  {
    section: 'text',
    title: 'Text directly in a layout element',
    config,
    tree: { [topBar]: component('<header>Docs</header>') },
    issues: [
      {
        issue: `error text-outside-text-element ${topBar}`,
        message: 'Text "Docs" is directly in <header> (line 2), but text belongs in a text element.',
      },
    ],
  },
  {
    section: 'lists',
    title: 'A list of elements instead of components',
    config,
    tree: { [topBar]: component('<ul>{links.map((link) => <li key={link}>{link}</li>)}</ul>') },
    issues: [`error list-shape-invalid ${topBar}`],
  },
  {
    section: 'lists',
    title: 'A condition with text as a branch',
    config,
    tree: { [topBar]: component("<div>{open ? 'Hide' : <p>Show</p>}</div>") },
    issues: [`error condition-shape-invalid ${topBar}`],
  },
  {
    section: 'links',
    title: 'A plain link to a page of the site',
    config: { ...config, router },
    tree: { [topBar]: component('<nav><a href="/docs">Docs</a></nav>') },
    issues: [
      {
        issue: `warning plain-internal-link ${topBar}`,
        message: '<a href="/docs"> (line 2) links to a path of the site, so it reloads the whole page.',
      },
    ],
  },
  {
    section: 'tables',
    title: 'A cell directly in a table',
    config,
    tree: { [topBar]: component('<table><td /></table>') },
    issues: [`error table-content-invalid ${topBar}`],
  },
];
