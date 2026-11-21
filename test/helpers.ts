import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { CONFIG_FILE } from '../src/shared/config/defaults.js';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Creates a temporary project. Keys are relative paths:
 * a path ending in "/" is an empty folder, anything else is a file with the given content.
 * A `config` object is written to the config file.
 */
export async function createProject(tree: Record<string, string>, config?: unknown): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'reactsmith-'));
  created.push(root);
  for (const [relPath, content] of Object.entries(tree)) {
    const full = path.join(root, relPath);
    if (relPath.endsWith('/')) {
      await mkdir(full, { recursive: true });
    } else {
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, content);
    }
  }
  if (config !== undefined) {
    await writeFile(path.join(root, CONFIG_FILE), JSON.stringify(config));
  }
  return root;
}

/** A fresh `npm create vite -- --template react-ts` src folder. */
export const VITE_TREE: Record<string, string> = {
  'src/main.tsx': `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
  'src/App.tsx': `import { useState } from 'react'
import heroImg from './assets/hero.png'
import reactLogo from './assets/react.svg'
import './App.css'

export default function App() {
  const [count, setCount] = useState(0)
  return <img src={reactLogo} alt={heroImg} onClick={() => setCount(count + 1)} />
}
`,
  'src/App.css': '.app {}\n',
  'src/index.css': ':root {}\n',
  'src/assets/react.svg': '<svg />',
  'src/assets/hero.png': 'png',
};

/** A full fresh Vite project: the src folder plus its config files. */
export const VITE_PROJECT: Record<string, string> = {
  ...VITE_TREE,
  'package.json': '{ "name": "app", "type": "module" }\n',
  'tsconfig.json': `{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
`,
  'tsconfig.app.json': `{
  "compilerOptions": {
    "target": "es2023",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "jsx": "react-jsx",

    /* Linting */
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
`,
  'vite.config.ts': `import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
`,
};

export async function read(root: string, relPath: string): Promise<string> {
  return readFile(path.join(root, relPath), 'utf8');
}

export async function exists(root: string, relPath: string): Promise<boolean> {
  return access(path.join(root, relPath)).then(
    () => true,
    () => false,
  );
}

/** The issues of a check, without the warnings for components nothing uses yet: fixtures often hold a lone component. */
export async function issuesOfUsedCode(root: string) {
  const { checkStructure } = await import('../src/shared/structure/check.js');
  return (await checkStructure(root)).issues.filter((issue) => issue.code !== 'component-unused');
}
