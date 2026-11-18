import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG_FILE, DEFAULT_COMPONENT_TYPES } from '../../src/shared/config/defaults.js';
import { runInit } from '../../src/commands/init/init.js';
import { createProject, exists, read, VITE_PROJECT } from '../helpers.js';

/** What init adds to every config: the types of shared components. */
const TYPES = { componentTypes: DEFAULT_COMPONENT_TYPES };

function actions(result: Awaited<ReturnType<typeof runInit>>): string[] {
  return result.actions.map((action) => `${action.type} ${action.path}`);
}

describe('runInit on a fresh Vite project', () => {
  it('moves the App files and sets everything up with --app-files app', async () => {
    const root = await createProject(VITE_PROJECT);
    const result = await runInit(root, { appFiles: 'app' });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(actions(result)).toEqual([
      'skip package.json',
      `create ${CONFIG_FILE}`,
      'move src/App.css',
      'move src/App.tsx',
      'update src/app/App.tsx',
      'update src/app/App.tsx',
      'update src/main.tsx',
      'update tsconfig.app.json',
      'update vite.config.ts',
      'create src/app/styles/global.css',
      'create src/app/styles/tokens/colors.json',
      'create src/app/styles/tokens/colors.css',
      'create src/app/styles/tokens/colors.ts',
      'create src/app/styles/tokens/typography.json',
      'create src/app/styles/tokens/typography.css',
      'create src/app/styles/tokens/typography.ts',
      'create src/app/styles/tokens/spacing.json',
      'create src/app/styles/tokens/spacing.css',
      'create src/app/styles/tokens/spacing.ts',
      'create src/app/styles/tokens/radius.json',
      'create src/app/styles/tokens/radius.css',
      'create src/app/styles/tokens/radius.ts',
      'create src/types/styleable.ts',
      'create src/types/index.ts',
      'create src/utils/cx.ts',
      'create src/utils/index.ts',
      'todo src/app/App.tsx',
      'create .claude/skills/reactsmith/SKILL.md',
      'create .claude/skills/reactsmith/by-hand.md',
      'create .claude/skills/reactsmith/commands.md',
      'create .claude/skills/reactsmith/drafts.md',
      'create .claude/skills/reactsmith/limits.md',
      'create .claude/skills/reactsmith-from-figma/SKILL.md',
      'create .claude/skills/reactsmith-from-figma/diff.mjs',
      'create .claude/skills/reactsmith-from-figma/export-format.md',
      'create .claude/skills/reactsmith-from-figma/export-node.js',
      'create .claude/skills/reactsmith-from-figma/fetch.mjs',
      'create .claude/skills/reactsmith-from-figma/figma-conventions.md',
      'create .claude/skills/reactsmith-from-figma/updating.md',
      'create .claude/skills/reactsmith-resolver/SKILL.md',
      'create CLAUDE.md',
    ]);

    expect(JSON.parse(await read(root, CONFIG_FILE))).toEqual({ appFiles: 'app', ...TYPES });
    expect(await exists(root, 'src/app/App.tsx')).toBe(true);
    expect(await exists(root, 'src/app/App.css')).toBe(true);
    expect(await read(root, 'src/main.tsx')).toContain("import App from './app/App.tsx'");
    expect(await read(root, 'src/app/App.tsx')).toContain("from '../assets/hero.png'");
    expect(await read(root, 'tsconfig.app.json')).toContain('"@/*"');
    // No Vite installed in the temp project, so the portable resolve.alias is used.
    expect(await read(root, 'vite.config.ts')).toContain("'@': fileURLToPath(new URL('./src', import.meta.url))");
  });

  it('is idempotent: a second run changes nothing', async () => {
    const root = await createProject(VITE_PROJECT);
    await runInit(root, { appFiles: 'app' });
    const before = await Promise.all(['src/main.tsx', 'tsconfig.app.json', 'vite.config.ts', CONFIG_FILE].map((f) => read(root, f)));

    const second = await runInit(root);
    expect(second.ok).toBe(true);
    // Without React Router the starter App stays, so importing the global styles remains a todo.
    expect(second.actions.every((action) => action.type === 'skip' || action.type === 'todo')).toBe(true);
    const after = await Promise.all(['src/main.tsx', 'tsconfig.app.json', 'vite.config.ts', CONFIG_FILE].map((f) => read(root, f)));
    expect(after).toEqual(before);
  });

  it('keeps the App files with --app-files root', async () => {
    const root = await createProject(VITE_PROJECT);
    const result = await runInit(root, { appFiles: 'root' });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(await exists(root, 'src/App.tsx')).toBe(true);
    expect(JSON.parse(await read(root, CONFIG_FILE))).toEqual({ appFiles: 'root', ...TYPES });
  });

  it('asks when interactive, and saves the answer', async () => {
    const root = await createProject(VITE_PROJECT);
    const confirm = vi.fn().mockResolvedValue(false);
    await runInit(root, { confirm });
    expect(confirm).toHaveBeenCalledWith('Move App.css, App.tsx into src/app/?');
    expect(JSON.parse(await read(root, CONFIG_FILE))).toEqual({ appFiles: 'root', ...TYPES });
  });

  it('uses the default (app) with --yes', async () => {
    const root = await createProject(VITE_PROJECT);
    await runInit(root, { yes: true });
    expect(await exists(root, 'src/app/App.tsx')).toBe(true);
  });

  it('fails without prompting when it cannot ask', async () => {
    const root = await createProject(VITE_PROJECT);
    const result = await runInit(root);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(['app-files-required']);
    expect(await exists(root, CONFIG_FILE)).toBe(false);
  });

  it('writes nothing with --dry-run', async () => {
    const root = await createProject(VITE_PROJECT);
    const result = await runInit(root, { appFiles: 'app', dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(await exists(root, CONFIG_FILE)).toBe(false);
    expect(await exists(root, 'src/App.tsx')).toBe(true);
    expect(await read(root, 'vite.config.ts')).toBe(VITE_PROJECT['vite.config.ts']);
  });
});

describe('runInit router detection', () => {
  function withDeps(deps: Record<string, string>) {
    return { ...VITE_PROJECT, 'package.json': JSON.stringify({ name: 'app', dependencies: deps }) };
  }

  it('records React Router 7 in data mode', async () => {
    const root = await createProject(withDeps({ 'react-router': '^7.9.0' }));
    await runInit(root, { appFiles: 'root' });
    expect(JSON.parse(await read(root, CONFIG_FILE))).toEqual({
      appFiles: 'root',
      router: { library: 'react-router', version: 7, mode: 'data' },
      ...TYPES,
    });
  });

  it('creates the app router and the not-found view, and renders the router in place of the Vite starter', async () => {
    const root = await createProject(withDeps({ 'react-router': '^7.9.0' }));
    const result = await runInit(root, { appFiles: 'app' });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(await read(root, 'src/app/router.tsx')).toBe(
      [
        "import { createBrowserRouter, type RouteObject } from 'react-router';",
        '',
        'const routes: RouteObject[] = [',
        '  {',
        "    path: '/',",
        '    children: [],',
        '  },',
        "  { path: '*', lazy: () => import('./views/NotFoundView') },",
        '];',
        '',
        'export const router = createBrowserRouter(routes);',
        '',
      ].join('\n'),
    );
    expect(await read(root, 'src/app/views/NotFoundView/NotFoundView.tsx')).toContain('<h1>Page not found</h1>');
    expect(result.actions).toContainEqual({ type: 'update', path: 'src/app/App.tsx', message: 'render the router with the global styles (replaces the Vite starter page)' });
    expect(await read(root, 'src/app/App.tsx')).toBe(
      [
        "import { RouterProvider } from 'react-router/dom';",
        "import { router } from './router';",
        "import './styles/global.css';",
        '',
        'function App() {',
        '  return <RouterProvider router={router} />;',
        '}',
        '',
        'export default App;',
        '',
      ].join('\n'),
    );
  });

  it('creates the global styles, and deletes what only the starter page used', async () => {
    const root = await createProject(withDeps({ 'react-router': '^7.9.0' }));
    const result = await runInit(root, { appFiles: 'app' });
    expect(result.actions.filter((action) => action.type === 'delete' || action.path.includes('styles'))).toEqual([
      { type: 'create', path: 'src/app/styles/global.css', message: 'global styles: design tokens and a reset' },
      { type: 'create', path: 'src/app/styles/tokens/colors.json', message: 'colors' },
      { type: 'create', path: 'src/app/styles/tokens/colors.css', message: 'colors variables' },
      { type: 'create', path: 'src/app/styles/tokens/colors.ts', message: 'colors token type' },
      { type: 'create', path: 'src/app/styles/tokens/typography.json', message: 'typography' },
      { type: 'create', path: 'src/app/styles/tokens/typography.css', message: 'typography variables' },
      { type: 'create', path: 'src/app/styles/tokens/typography.ts', message: 'typography token type' },
      { type: 'create', path: 'src/app/styles/tokens/spacing.json', message: 'spacing' },
      { type: 'create', path: 'src/app/styles/tokens/spacing.css', message: 'spacing variables' },
      { type: 'create', path: 'src/app/styles/tokens/spacing.ts', message: 'spacing token type' },
      { type: 'create', path: 'src/app/styles/tokens/radius.json', message: 'radius' },
      { type: 'create', path: 'src/app/styles/tokens/radius.css', message: 'radius variables' },
      { type: 'create', path: 'src/app/styles/tokens/radius.ts', message: 'radius token type' },
      { type: 'delete', path: 'src/App.css', message: 'styles of the Vite starter page' },
      { type: 'delete', path: 'src/assets/hero.png', message: 'image of the Vite starter page' },
      { type: 'delete', path: 'src/assets/react.svg', message: 'image of the Vite starter page' },
      { type: 'delete', path: 'src/index.css', message: 'global styles of the Vite starter, replaced by the app global styles' },
    ]);
    // App.css is deleted where it was, not moved first.
    expect(result.actions.map((action) => `${action.type} ${action.path}`)).not.toContain('move src/App.css');
    for (const file of ['src/App.css', 'src/app/App.css', 'src/index.css', 'src/assets']) expect(await exists(root, file)).toBe(false);
    expect(await read(root, 'src/main.tsx')).not.toContain('index.css');
    expect(await read(root, 'src/app/styles/global.css')).toContain("@import './tokens/colors.css';\n@import './tokens/typography.css';");
    expect(await read(root, 'src/app/styles/tokens/colors.css')).toContain('--color-border: light-dark(');
  });

  it('writes Tailwind global styles when the styles are Tailwind', async () => {
    const root = await createProject(withDeps({ 'react-router': '^7.9.0', tailwindcss: '^4.1.0' }));
    await runInit(root, { appFiles: 'app', styles: 'tailwind' });
    const css = await read(root, 'src/app/styles/global.css');
    expect(css).toContain('@import "tailwindcss";\n@import \'./tokens/colors.css\';\n@import \'./tokens/typography.css\';');
    expect(await read(root, 'src/app/styles/tokens/typography.css')).toContain('@theme {\n  --font-sans: ');
  });

  it('renders the router from the source root when the App files stay there', async () => {
    const root = await createProject(withDeps({ 'react-router': '^7.9.0' }));
    await runInit(root, { appFiles: 'root' });
    expect(await read(root, 'src/App.tsx')).toContain("import { router } from './app/router';\nimport './app/styles/global.css';");
  });

  it('leaves todos for an App component of the dev', async () => {
    const custom = await createProject({ ...withDeps({ 'react-router': '^7.9.0' }), 'src/App.tsx': 'export default function App() { return <h1>Mine</h1>; }\n' });
    const result = await runInit(custom, { appFiles: 'root' });
    expect(result.actions.filter((action) => action.path === 'src/App.tsx')).toEqual([
      { type: 'todo', path: 'src/App.tsx', message: 'render <RouterProvider router={router} /> (from "react-router/dom") in your App component' },
      { type: 'todo', path: 'src/App.tsx', message: "import the global styles: import './app/styles/global.css';" },
    ]);
    expect(await read(custom, 'src/App.tsx')).toBe('export default function App() { return <h1>Mine</h1>; }\n');
    expect(await exists(custom, 'src/index.css')).toBe(true);

    const done = "import { RouterProvider } from 'react-router/dom';\nimport './app/styles/global.css';\nexport default function App() { return <RouterProvider router={router} />; }\n";
    const ready = await createProject({ ...withDeps({ 'react-router': '^7.9.0' }), 'src/App.tsx': done });
    const again = await runInit(ready, { appFiles: 'root' });
    expect(again.actions.filter((action) => action.path === 'src/App.tsx')).toEqual([]);
  });

  it('keeps an existing app router', async () => {
    const root = await createProject({ ...withDeps({ 'react-router': '^7.9.0' }), 'src/app/router.tsx': '// mine\n' });
    const result = await runInit(root, { appFiles: 'root' });
    expect(await read(root, 'src/app/router.tsx')).toBe('// mine\n');
    expect(result.actions).toContainEqual({ type: 'skip', path: 'src/app/router.tsx', message: 'app router already exists' });
  });

  it('accepts react-router-dom 7, the compatibility package', async () => {
    const root = await createProject(withDeps({ 'react-router-dom': '7.1.0' }));
    await runInit(root, { appFiles: 'root' });
    expect(JSON.parse(await read(root, CONFIG_FILE)).router).toEqual({ library: 'react-router', version: 7, mode: 'data' });
  });

  it('explains how to install a missing router with the project package manager', async () => {
    const missing = await runInit(await createProject({ ...VITE_PROJECT, 'pnpm-lock.yaml': '' }), { appFiles: 'root' });
    expect(missing.actions[0]).toEqual({
      type: 'skip',
      path: 'package.json',
      message:
        'React Router not found, routing not configured. To use routing, run "pnpm add react-router", then "reactsmith init" again',
    });
  });

  it('explains how to upgrade an unsupported router', async () => {
    const root = await createProject({ ...withDeps({ 'react-router-dom': '^6.28.0' }), 'package-lock.json': '{}' });
    const old = await runInit(root, { appFiles: 'root' });
    expect(old.actions[0]?.message).toBe(
      'React Router 6 is not supported yet (supported: 7), routing not configured. ' +
        'To upgrade, run "npm install react-router@7", then "reactsmith init" again',
    );
    expect(JSON.parse(await read(root, CONFIG_FILE))).toEqual({ appFiles: 'root', ...TYPES });
  });

  it('adds the router to an existing config and reports only that change', async () => {
    const root = await createProject(withDeps({ 'react-router': '^7.0.0' }), { appFiles: 'root' });
    const result = await runInit(root);
    expect(result.actions).toContainEqual({
      type: 'update',
      path: CONFIG_FILE,
      message: expect.stringContaining('set "router": {"library":"react-router","version":7,"mode":"data"}'),
    });
  });

  it('leaves a configured router alone', async () => {
    const router = { library: 'react-router', version: 7, mode: 'data' };
    const root = await createProject(withDeps({ 'react-router': '^7.0.0' }), { appFiles: 'root', router });
    const result = await runInit(root);
    expect(result.actions.filter((action) => action.path === 'package.json')).toEqual([]);
    // Only the component types are added: the router is left as it is.
    expect(result.actions.find((action) => action.path === CONFIG_FILE)?.message).toBe('set "componentTypes": ' + JSON.stringify(DEFAULT_COMPONENT_TYPES));
  });
});

describe('runInit layout detection', () => {
  const withMui = { ...VITE_PROJECT, 'package.json': JSON.stringify({ name: 'app', dependencies: { '@mui/material': '^7.3.0' } }) };

  it('records the MUI preset when @mui/material is installed', async () => {
    const root = await createProject(withMui);
    await runInit(root, { appFiles: 'root' });
    expect(JSON.parse(await read(root, CONFIG_FILE)).layoutComponents).toEqual({
      '@mui/material': ['Box', 'Container', 'Grid', 'Stack'],
      html: ['main', 'section', 'article', 'aside', 'dialog', 'details', 'form', 'fieldset', 'header', 'footer', 'nav', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    });
  });

  it('keeps the HTML default without a UI library, and configured layout components', async () => {
    const plain = await createProject(VITE_PROJECT);
    await runInit(plain, { appFiles: 'root' });
    expect(JSON.parse(await read(plain, CONFIG_FILE))).not.toHaveProperty('layoutComponents');

    const layoutComponents = { html: ['div'] };
    const configured = await createProject(withMui, { appFiles: 'root', layoutComponents });
    await runInit(configured);
    expect(JSON.parse(await read(configured, CONFIG_FILE)).layoutComponents).toEqual(layoutComponents);
  });
});

describe('runInit styles detection', () => {
  const withTailwind = () => createProject({ ...VITE_PROJECT, 'package.json': JSON.stringify({ name: 'app', devDependencies: { tailwindcss: '^4.1.0' } }) });
  const styles = async (root: string) => JSON.parse(await read(root, CONFIG_FILE)).styles;

  it('does not take Tailwind being installed as the choice: asks, recommending CSS Modules, and saves the answer', async () => {
    const questions: string[] = [];
    const asked = await withTailwind();
    await runInit(asked, { appFiles: 'root', confirm: async (question) => (questions.push(question), true) });
    const aboutStyles = () => questions.filter((question) => question.startsWith('Tailwind'));
    expect(aboutStyles()).toEqual(['Tailwind is installed. Write the styles as Tailwind classes (Name.styles.ts) instead of CSS Modules (Name.module.css, plain CSS: recommended)?']);
    expect(await styles(asked)).toBe('tailwind');
    // Saved: a later init doesn't ask again.
    await runInit(asked, { confirm: async (question) => (questions.push(question), false) });
    expect(aboutStyles()).toHaveLength(1);

    const declined = await withTailwind();
    await runInit(declined, { appFiles: 'root', confirm: async () => false });
    expect(await styles(declined)).toBe('css-modules');
  }, 20_000);

  it('uses CSS Modules when nobody can be asked, saying how to choose Tailwind; --styles decides it', async () => {
    const quiet = await withTailwind();
    const result = await runInit(quiet, { appFiles: 'root' });
    expect(await styles(quiet)).toBe('css-modules');
    expect(result.issues.map((issue) => issue.code)).toContain('styles-tailwind-installed');

    const chosen = await withTailwind();
    expect((await runInit(chosen, { appFiles: 'root', styles: 'tailwind' })).issues.map((issue) => issue.code)).not.toContain('styles-tailwind-installed');
    expect(await styles(chosen)).toBe('tailwind');
    // Another choice later is a conversion, not an init option.
    expect((await runInit(chosen, { styles: 'css-modules' })).issues.map((issue) => issue.code)).toEqual(['styles-conflict']);
  });

  it('keeps the CSS Modules default without Tailwind, saving nothing', async () => {
    const plain = await createProject(VITE_PROJECT);
    await runInit(plain, { appFiles: 'root' });
    expect(JSON.parse(await read(plain, CONFIG_FILE))).not.toHaveProperty('styles');
  });
});

describe('runInit with an existing config', () => {
  it('adds appFiles without touching the rest of the file', async () => {
    const root = await createProject(VITE_PROJECT);
    await writeFile(path.join(root, CONFIG_FILE), '{\n  "folders": { "features": "apps" }\n}\n');
    await runInit(root, { appFiles: 'root' });
    expect(JSON.parse(await read(root, CONFIG_FILE))).toEqual({ folders: { features: 'apps' }, appFiles: 'root', ...TYPES });
  });

  it('moves the App files when the config already says "app"', async () => {
    const root = await createProject(VITE_PROJECT, { appFiles: 'app' });
    const result = await runInit(root);
    expect(result.ok).toBe(true);
    expect(await exists(root, 'src/app/App.tsx')).toBe(true);
    expect(result.actions.find((action) => action.path === CONFIG_FILE)?.message).not.toContain('appFiles');
  });

  it('refuses a conflicting --app-files', async () => {
    const root = await createProject(VITE_PROJECT, { appFiles: 'root' });
    const result = await runInit(root, { appFiles: 'app' });
    expect(result.issues.map((issue) => issue.code)).toEqual(['app-files-conflict']);
  });

  it('stops on an invalid config', async () => {
    const root = await createProject(VITE_PROJECT, { folders: { features: null } });
    const result = await runInit(root, { appFiles: 'app' });
    expect(result.ok).toBe(false);
    expect(await exists(root, 'src/App.tsx')).toBe(true);
  });

  it('skips the alias when it is disabled', async () => {
    const root = await createProject(VITE_PROJECT, { alias: null });
    await runInit(root, { appFiles: 'root' });
    expect(await read(root, 'tsconfig.app.json')).toBe(VITE_PROJECT['tsconfig.app.json']);
    expect(await read(root, 'vite.config.ts')).toBe(VITE_PROJECT['vite.config.ts']);
  });

  it('refuses to overwrite an existing app/App.tsx', async () => {
    const root = await createProject({ ...VITE_PROJECT, 'src/app/App.tsx': '' }, { appFiles: 'app' });
    const result = await runInit(root);
    expect(result.issues.map((issue) => issue.code)).toEqual(['move-failed']);
    expect(await exists(root, 'src/App.tsx')).toBe(true);
  });
});

/** A create-next-app project with the src/ folder: the root layout imports the starter's globals.css. */
const NEXT_PROJECT: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { next: '^15.5.0', react: '^19.0.0' } }),
  'tsconfig.json': '{\n  "compilerOptions": {\n    "jsx": "preserve",\n    "paths": { "@/*": ["./src/*"] }\n  }\n}\n',
  'next.config.ts': 'const nextConfig = {};\nexport default nextConfig;\n',
  'src/app/layout.tsx': [
    "import { Geist, Geist_Mono } from 'next/font/google';",
    "import './globals.css';",
    '',
    "const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });",
    "const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });",
    '',
    'export default function RootLayout({ children }: { children: React.ReactNode }) {',
    '  return (',
    '    <html lang="en">',
    '      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>',
    '    </html>',
    '  );',
    '}',
    '',
  ].join('\n'),
  'src/app/globals.css': 'body {\n  margin: 0;\n  font-family: var(--font-geist-sans);\n}\n\ncode {\n  font-family: var(--font-geist-mono);\n}\n',
  'src/app/favicon.ico': '',
  'src/app/page.tsx': 'export default function Home() {\n  return null;\n}\n',
  'src/app/docs/[slug]/page.tsx': 'export default function Doc() {\n  return null;\n}\n',
};

describe('runInit on a Next.js project', () => {
  it('records the framework and leaves routing and src/app to Next: no App files, no router, no Vite alias', async () => {
    const root = await createProject({ ...NEXT_PROJECT, 'vite.config.ts': 'export default {};\n' });
    const result = await runInit(root, { noSkills: true });

    expect(JSON.parse(await read(root, CONFIG_FILE))).toEqual({ framework: 'next', ...TYPES });
    expect(result.actions.find((action) => action.path === 'package.json')).toMatchObject({ type: 'skip', message: expect.stringContaining('Next.js project') });
    expect(await exists(root, 'src/app/router.tsx')).toBe(false);
    expect(await exists(root, 'src/app/App.tsx')).toBe(false);
    expect(await read(root, 'vite.config.ts')).toBe('export default {};\n');
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    // ReactSmith's app folder is the shell: src/app is Next's.
    expect(await exists(root, 'src/shell/styles/global.css')).toBe(true);
    expect(await exists(root, 'src/app/styles')).toBe(false);
    expect(result.actions.filter((action) => action.type === 'todo').map((action) => `${action.path}: ${action.message}`)).toEqual([
      "src/app/layout.tsx: import the global styles: import '../shell/styles/global.css'; (in place of './globals.css')",
    ]);
  });

  it('sets up no router even with React Router installed', async () => {
    const root = await createProject({ ...NEXT_PROJECT, 'package.json': JSON.stringify({ name: 'app', dependencies: { next: '^15.5.0', 'react-router': '^7.9.0' } }) });
    await runInit(root, { noSkills: true });
    expect(JSON.parse(await read(root, CONFIG_FILE)).router).toBeUndefined();
  });

  it('keeps the framework the config sets', async () => {
    const root = await createProject(NEXT_PROJECT, { framework: 'vite', appFiles: 'root' });
    await runInit(root, { noSkills: true });
    expect(JSON.parse(await read(root, CONFIG_FILE)).framework).toBe('vite');
  });

  it('asks for the src/ folder when the app is at the root', async () => {
    const root = await createProject({ 'package.json': NEXT_PROJECT['package.json']!, 'app/layout.tsx': NEXT_PROJECT['src/app/layout.tsx']! });
    const result = await runInit(root, { noSkills: true });
    expect(result.issues).toEqual([expect.objectContaining({ code: 'src-missing', hint: expect.stringContaining('create-next-app --src-dir') })]);
  });
});
