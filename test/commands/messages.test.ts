import { describe, expect, it } from 'vitest';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { elementUpdateCommand } from '../../src/commands/element/update/command.js';
import { messagesCommand } from '../../src/commands/messages/command.js';
import { runInit } from '../../src/commands/init/init.js';
import { CONFIG_FILE } from '../../src/shared/config/defaults.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read } from '../helpers.js';

const dir = 'src/app/components/TopBar';
const file = `${dir}/TopBar.tsx`;
const id = 'app/components/TopBar/TopBar.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;
const i18n = { library: 'next-intl', messages: 'messages/{locale}.json', defaultLocale: 'it' };

const TOP_BAR = {
  [file]: lines('export const TopBar: React.FC = () => {', '  return (', '    <header>', '      <nav />', '    </header>', '  );', '};'),
  [`${dir}/index.ts`]: "export { TopBar } from './TopBar';\n",
  'src/app/App.tsx': "import { TopBar } from './components/TopBar';\n\nexport const App = () => <TopBar />;\n",
};

const project = (config: object = { appFiles: 'app', i18n }) => createProject(TOP_BAR, config);

const messages = (root: string, options: { set?: string; locale?: string; remove?: string }) =>
  messagesCommand.run({ cwd: root, args: {}, options: { set: options.set, locale: options.locale, remove: options.remove, dryRun: false } });

const insert = (root: string, tag: string, into: string, options: { message?: string; text?: string; name?: string; props?: string } = {}) =>
  elementInsertCommand.run({
    cwd: root,
    args: { name: tag },
    options: {
      around: undefined, through: undefined, if: undefined, fallback: undefined, into, position: undefined, from: undefined, props: options.props,
      text: options.text, message: options.message, name: options.name, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined,
      each: undefined, as: undefined, key: undefined, dryRun: false,
    },
  });

const update = (root: string, target: string, options: { message?: string; text?: string; props?: string }) =>
  elementUpdateCommand.run({ cwd: root, args: { target }, options: { text: options.text, message: options.message, props: options.props, removeProps: undefined, dryRun: false } });

const json = async (root: string, locale: string) => JSON.parse(await read(root, `messages/${locale}.json`));
const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);

describe('messages', () => {
  it('sets texts one language at a time, creating the file of a new language', async () => {
    const root = await project();
    const result = await messages(root, { set: 'TopBar.workshops=Laboratori; TopBar.register=Iscriviti', locale: 'it' });
    expect(result).toMatchObject({ ok: true, summary: 'Messages updated: TopBar.workshops, TopBar.register.' });
    expect(result.actions?.map((action) => `${action.type} ${action.path}`)).toEqual(['create messages/it.json']);
    await messages(root, { set: 'TopBar.workshops=Workshops; TopBar.faq=Questions\\; answers', locale: 'en' });
    expect(await json(root, 'it')).toEqual({ TopBar: { workshops: 'Laboratori', register: 'Iscriviti' } });
    expect(await json(root, 'en')).toEqual({ TopBar: { workshops: 'Workshops', faq: 'Questions; answers' } });
  });

  it('refuses keys without a group, --set without a language, and a text where a group is', async () => {
    const root = await project();
    expect(codes(await messages(root, { set: 'workshops=Laboratori', locale: 'it' }))).toEqual(['message-key-invalid']);
    expect(codes(await messages(root, { set: 'TopBar.workshops=Laboratori' }))).toEqual(['options-conflict']);
    await messages(root, { set: 'TopBar.links.faq=FAQ', locale: 'it' });
    expect(codes(await messages(root, { set: 'TopBar.links=Link', locale: 'it' }))).toEqual(['message-key-taken']);
  });

  it('refuses everything without translations set up, saying how to set them up', async () => {
    const root = await project({ appFiles: 'app' });
    expect(codes(await messages(root, { set: 'TopBar.workshops=Workshops', locale: 'en' }))).toEqual(['i18n-not-configured']);
    expect(codes(await insert(root, 'span', `${id}#header`, { message: 'workshops' }))).toEqual(['i18n-not-configured']);
  });
});

describe('element insert and update --message', () => {
  it("shows a message of the component's group, giving the component its translator once", async () => {
    const root = await project();
    await messages(root, { set: 'TopBar.workshops=Laboratori; TopBar.register=Iscriviti', locale: 'it' });
    expect((await insert(root, 'a', `${id}#header`, { message: 'workshops' })).ok).toBe(true);
    expect((await insert(root, 'button', `${id}#header`, { message: 'register' })).ok).toBe(true);
    expect(await read(root, file)).toBe(
      lines(
        "import { useTranslations } from 'next-intl';",
        '',
        'export const TopBar: React.FC = () => {',
        "  const t = useTranslations('TopBar');",
        '  return (',
        '    <header>',
        '      <nav />',
        "      <a>{t('workshops')}</a>",
        "      <button>{t('register')}</button>",
        '    </header>',
        '  );',
        '};',
      ),
    );
  });

  it("gives props a message of the component's group, with its translator, and check counts it as used", async () => {
    const root = await project();
    await messages(root, { set: 'TopBar.menu=Menu; TopBar.close=Chiudi', locale: 'it' });
    await messages(root, { set: 'TopBar.menu=Menu; TopBar.close=Close', locale: 'en' });
    expect(codes(await insert(root, 'button', `${id}#header`, { props: "type='button' aria-label={t('menu')}", name: 'toggle' }))).toEqual([]);
    expect(codes(await update(root, `${id}#toggle`, { props: "title={t('close')}" }))).toEqual([]);
    const text = await read(root, file);
    expect(text).toContain("const t = useTranslations('TopBar');");
    expect(text).toContain("<button className={styles.toggle} type='button' aria-label={t('menu')} title={t('close')} />");
    expect(text.split("useTranslations('TopBar')")).toHaveLength(2);
    const { issues } = await checkStructure(root);
    expect(issues.filter((issue) => issue.code.startsWith('message'))).toEqual([]);
  });

  it('refuses a prop message without its text, another function, and calls in an app without translations', async () => {
    const root = await project();
    expect(codes(await insert(root, 'button', `${id}#header`, { props: "aria-label={t('menu')}" }))).toEqual(['message-missing']);
    expect(codes(await insert(root, 'button', `${id}#header`, { props: "aria-label={format('menu')}" }))).toEqual(['value-expression-not-allowed']);
    const plain = await project({ appFiles: 'app' });
    expect(codes(await insert(plain, 'button', `${id}#header`, { props: "aria-label={t('menu')}" }))).toEqual(['value-expression-not-allowed']);
  });

  it('refuses a key without its text in the default language, saying how to add it', async () => {
    const root = await project();
    const result = await insert(root, 'span', `${id}#header`, { message: 'workshops' });
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'message-missing',
        message: '"TopBar.workshops" is not in messages/it.json: TopBar shows the messages of its group "TopBar".',
        hint: 'Add its text first: "reactsmith messages --set \\"TopBar.workshops=…\\" --locale it".',
      }),
    ]);
    expect(codes(await insert(root, 'span', `${id}#header`, { message: 'workshops', text: 'Workshops' }))).toEqual(['options-conflict']);
  });

  it('turns a literal text into a message, and back', async () => {
    const root = await project();
    await messages(root, { set: 'TopBar.register=Iscriviti', locale: 'it' });
    await insert(root, 'button', `${id}#header`, { text: 'Register', name: 'register' });
    expect((await update(root, `${id}#register`, { message: 'register' })).ok).toBe(true);
    expect(await read(root, file)).toContain("<button className={styles.register}>{t('register')}</button>");
    expect((await update(root, `${id}#register`, { text: 'Iscriviti' })).ok).toBe(true);
    expect(await read(root, file)).toContain('<button className={styles.register}>Iscriviti</button>');
  });
});

describe('messages --remove and check', () => {
  it('refuses to remove a text an element shows, removes the others from every language, and check passes', async () => {
    const root = await project();
    await messages(root, { set: 'TopBar.workshops=Laboratori; TopBar.old=Vecchio', locale: 'it' });
    await messages(root, { set: 'TopBar.workshops=Workshops; TopBar.old=Old', locale: 'en' });
    await insert(root, 'a', `${id}#header`, { message: 'workshops' });

    const issues = async () => (await checkStructure(root)).issues.filter((issue) => issue.code.startsWith('message') || issue.code === 'text-not-translated');
    expect((await issues()).map((issue) => issue.code)).toEqual(['message-unused']);

    expect((await messages(root, { remove: 'TopBar.workshops' })).issues).toEqual([
      expect.objectContaining({ code: 'message-in-use', message: `"TopBar.workshops" is still shown in ${file}.` }),
    ]);
    expect((await messages(root, { remove: 'TopBar.old' })).ok).toBe(true);
    expect(await json(root, 'en')).toEqual({ TopBar: { workshops: 'Workshops' } });
    expect(await issues()).toEqual([]);
  });
});

describe('init and translations', () => {
  const NEXT_INTL = {
    'package.json': JSON.stringify({ name: 'app', dependencies: { next: '^15.5.0', 'next-intl': '^4.3.0' } }),
    'tsconfig.json': '{\n  "compilerOptions": {\n    "paths": { "@/*": ["./src/*"] }\n  }\n}\n',
    'src/app/[locale]/layout.tsx': 'export default function Layout({ children }: { children: React.ReactNode }) {\n  return children;\n}\n',
    'messages/en.json': '{}\n',
    'messages/it.json': '{}\n',
  };

  it("records next-intl with the default language of its routing, and the message folder", async () => {
    const root = await createProject({ ...NEXT_INTL, 'src/i18n/routing.ts': "export const routing = defineRouting({ locales: ['it', 'en'], defaultLocale: 'it' });\n" });
    await runInit(root, { noSkills: true });
    expect(JSON.parse(await read(root, CONFIG_FILE)).i18n).toEqual({ library: 'next-intl', messages: 'messages/{locale}.json', defaultLocale: 'it' });
  });

  it("knows next-intl's setup folder, src/i18n", async () => {
    const root = await createProject({ ...TOP_BAR, 'src/i18n/routing.ts': 'export const routing = {};\n', 'messages/it.json': '{}\n' }, { appFiles: 'app', i18n });
    const folders = (await checkStructure(root)).issues.filter((issue) => issue.path?.startsWith('src/i18n'));
    expect(folders).toEqual([]);
  });

  it('says what to set when it finds no default language', async () => {
    const root = await createProject(NEXT_INTL);
    const result = await runInit(root, { noSkills: true });
    expect(JSON.parse(await read(root, CONFIG_FILE)).i18n).toBeUndefined();
    expect(result.actions.find((action) => action.message?.startsWith('next-intl found'))?.message).toBe(
      'next-intl found, but not the default language: set "i18n" in reactsmith.config.json, e.g. { "library": "next-intl", "messages": "messages/{locale}.json", "defaultLocale": "en" }',
    );
  });
});
