import { describe, expect, it } from 'vitest';
import { runRule, summary, testExamples } from '../../../../../test/rules.js';
import { codes, examples } from './examples.js';
import { checkMessages } from './messages.js';

const config = { appFiles: 'app', i18n: { library: 'next-intl', messages: 'messages/{locale}.json', defaultLocale: 'it' } };
const topBar = 'src/app/components/TopBar/TopBar.tsx';
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe('messages: examples', () => {
  testExamples(checkMessages, examples, codes);
});

describe('messages', () => {
  it('checks nothing in an app without translations', async () => {
    expect(await runRule(checkMessages, { [topBar]: 'export const TopBar: React.FC = () => <header>Workshops</header>;\n' }, { appFiles: 'app' })).toEqual([]);
  });

  it('counts every key of a group read with computed keys as used, and keys of pages outside the units', async () => {
    const tree = {
      [topBar]: "import { useTranslations } from 'next-intl';\n\nexport const TopBar: React.FC<{ links: { label: string }[] }> = ({ links }) => {\n  const t = useTranslations('Nav');\n  return <nav>{links.map((link) => <a key={link.label}>{t(link.label)}</a>)}</nav>;\n};\n",
      'src/app/page.tsx': "import { getTranslations } from 'next-intl/server';\n\nexport default async function Page() {\n  const t = await getTranslations('Home');\n  return <h1>{t('title')}</h1>;\n}\n",
      'messages/it.json': json({ Nav: { workshops: 'Laboratori', faq: 'FAQ' }, Home: { title: 'Benvenuti' } }),
    };
    expect(summary(await runRule(checkMessages, tree, config))).toEqual([]);
  });

  it('leaves numbers and symbols alone, and lists the first texts of a component', async () => {
    const tree = {
      [topBar]: 'export const TopBar: React.FC = () => <header><span>2027</span><span>·</span><span>One</span><span>Two</span><span>Three</span><span>Four</span></header>;\n',
      'messages/it.json': json({}),
    };
    const issues = await runRule(checkMessages, tree, config);
    expect(issues.map((issue) => issue.message)).toEqual(['TopBar shows 4 texts that every language would see as written: "One", "Two", "Three"….']);
  });
});
