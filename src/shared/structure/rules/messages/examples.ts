import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['messages-default-missing', 'messages-invalid', 'message-missing', 'message-untranslated', 'message-unused', 'text-not-translated'] as const;

/** The parts of the rule, in page order. */
export const sections = {
  files: 'Message files',
  keys: 'Keys',
  texts: 'Texts',
} as const;

const config = { appFiles: 'app', i18n: { library: 'next-intl', messages: 'messages/{locale}.json', defaultLocale: 'it' } };
const topBar = 'src/app/components/TopBar/TopBar.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

/** A TopBar showing `children` in its header, with its translator. */
const topBarFile = (children: string) =>
  lines(
    "import { useTranslations } from 'next-intl';",
    '',
    'export const TopBar: React.FC = () => {',
    "  const t = useTranslations('TopBar');",
    `  return <header>${children}</header>;`,
    '};',
  );

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const IT = json({ TopBar: { workshops: 'Laboratori', register: 'Iscriviti' } });
const EN = json({ TopBar: { workshops: 'Workshops', register: 'Register' } });
const SHOWN = "<a>{t('workshops')}</a><button>{t('register')}</button>";

export const examples: RuleExample<keyof typeof sections>[] = [
  {
    title: 'Every text a message, in every language',
    config,
    tree: { [topBar]: topBarFile(SHOWN), 'messages/it.json': IT, 'messages/en.json': EN },
    issues: [],
  },
  {
    section: 'files',
    title: 'No file for the default language',
    config,
    tree: { [topBar]: topBarFile(''), 'messages/en.json': EN },
    issues: [
      {
        issue: 'error messages-default-missing messages/it.json',
        message: 'messages/it.json, the messages of the default language "it", doesn\'t exist.',
        hint: 'Create it with the first texts: "reactsmith messages --set \\"Group.key=Text\\" --locale it".',
      },
    ],
  },
  {
    section: 'files',
    title: 'A message file that is not messages',
    config,
    tree: { [topBar]: topBarFile(SHOWN), 'messages/it.json': IT, 'messages/en.json': json({ TopBar: { workshops: ['Workshops'] } }) },
    issues: [
      {
        issue: 'error messages-invalid messages/en.json',
        message: '"TopBar.workshops" in messages/en.json is neither a text nor a group of keys.',
        hint: 'A message is a string; a group is an object of messages.',
      },
    ],
  },
  {
    section: 'keys',
    title: 'A key without its text in the default language',
    config,
    tree: { [topBar]: topBarFile("<a>{t('workshops')}</a><button>{t('register')}</button><a>{t('faq')}</a>"), 'messages/it.json': IT, 'messages/en.json': EN },
    issues: [
      {
        issue: `error message-missing ${topBar}`,
        message: '"TopBar.faq" (line 5) is not in messages/it.json, so the page shows the key instead of a text.',
        hint: 'Add its text: "reactsmith messages --set \\"TopBar.faq=…\\" --locale it".',
      },
    ],
  },
  {
    section: 'keys',
    title: 'A language with texts still to translate',
    config,
    tree: { [topBar]: topBarFile(SHOWN), 'messages/it.json': IT, 'messages/en.json': json({ TopBar: { workshops: 'Workshops' } }) },
    issues: [
      {
        issue: 'warning message-untranslated messages/en.json',
        message: 'messages/en.json lacks 1 text of messages/it.json: TopBar.register.',
        hint: 'Translate them: "reactsmith messages --set \\"TopBar.register=…\\" --locale en".',
      },
    ],
  },
  {
    section: 'keys',
    title: 'A text no element shows',
    config,
    tree: { [topBar]: topBarFile("<a>{t('workshops')}</a>"), 'messages/it.json': IT, 'messages/en.json': EN },
    issues: [
      {
        issue: 'warning message-unused messages/it.json',
        message: 'A text is shown nowhere: TopBar.register.',
        hint: 'Show it with "element insert … --message <key>", or remove it: "reactsmith messages --remove \\"TopBar.register\\"".',
      },
    ],
  },
  {
    section: 'texts',
    title: 'A component showing literal texts',
    config,
    tree: { [topBar]: topBarFile("<a>{t('workshops')}</a><button>{t('register')}</button><span>Policoro in Swing</span>"), 'messages/it.json': IT, 'messages/en.json': EN },
    issues: [
      {
        issue: `warning text-not-translated ${topBar}`,
        message: 'TopBar shows a text that every language would see as written: "Policoro in Swing".',
        hint: 'Make each one a message: "reactsmith messages --set \\"TopBar.<key>=…\\" --locale it", then "element update <id> --message <key>".',
      },
    ],
  },
];
